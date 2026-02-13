import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { asInteger, asNonEmptyString, isRecord } from "../lib/validation";
import type { AppEnv } from "../types";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface KnownPattern {
  pattern: string;
  success_count: number;
  last_used: string;
  context: Record<string, unknown>;
}

interface FailedPattern {
  pattern: string;
  reason: string;
  timestamp: string;
  context: Record<string, unknown>;
}

interface GenerationStats {
  total_runs: number;
  successful_generations: number;
  failed_generations: number;
  total_tests_generated: number;
  total_tests_passing: number;
  last_run: string;
}

interface KnownIssue {
  issue: string;
  workaround: string | null;
  timestamp: string;
  context: Record<string, unknown>;
}

interface ProjectMemoryRow {
  id: string;
  projectId: string;
  version: number;
  conventions: string | null;
  knownPatterns: string | null;
  failedPatterns: string | null;
  generationStats: string | null;
  source: string | null;
  updatedAt: string;
  createdAt: string;
}

interface PackageMemoryRow {
  id: string;
  projectId: string;
  packageName: string;
  version: number;
  testPatterns: string | null;
  knownIssues: string | null;
  coverageHistory: string | null;
  llmFeedback: string | null;
  updatedAt: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const MAX_HISTORY_ENTRIES = 50;

function parseJsonArray<T>(value: string | null): T[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/*  Merge Logic                                                               */
/* -------------------------------------------------------------------------- */

function mergeKnownPatterns(server: KnownPattern[], incoming: KnownPattern[]): KnownPattern[] {
  const map = new Map<string, KnownPattern>();

  for (const p of server) {
    map.set(p.pattern, { ...p });
  }

  for (const p of incoming) {
    const existing = map.get(p.pattern);
    if (existing) {
      existing.success_count = Math.max(existing.success_count, p.success_count ?? 0);
      if (p.last_used > existing.last_used) {
        existing.last_used = p.last_used;
        existing.context = p.context ?? {};
      }
    } else {
      map.set(p.pattern, { ...p });
    }
  }

  return Array.from(map.values());
}

function mergeFailedPatterns(server: FailedPattern[], incoming: FailedPattern[]): FailedPattern[] {
  const seen = new Set(server.map((p) => p.pattern));
  const merged = [...server];

  for (const p of incoming) {
    if (!seen.has(p.pattern)) {
      merged.push(p);
      seen.add(p.pattern);
    }
  }

  return merged;
}

function mergeGenerationStats(server: GenerationStats, incoming: GenerationStats): GenerationStats {
  return {
    total_runs: Math.max(server.total_runs ?? 0, incoming.total_runs ?? 0),
    successful_generations: Math.max(server.successful_generations ?? 0, incoming.successful_generations ?? 0),
    failed_generations: Math.max(server.failed_generations ?? 0, incoming.failed_generations ?? 0),
    total_tests_generated: Math.max(server.total_tests_generated ?? 0, incoming.total_tests_generated ?? 0),
    total_tests_passing: Math.max(server.total_tests_passing ?? 0, incoming.total_tests_passing ?? 0),
    last_run: server.last_run > incoming.last_run ? server.last_run : incoming.last_run
  };
}

function mergeKnownIssues(server: KnownIssue[], incoming: KnownIssue[]): KnownIssue[] {
  const seen = new Set(server.map((i) => i.issue));
  const merged = [...server];

  for (const i of incoming) {
    if (!seen.has(i.issue)) {
      merged.push(i);
      seen.add(i.issue);
    }
  }

  return merged;
}

function mergeAppendCapped<T>(server: T[], incoming: T[], cap: number): T[] {
  const combined = [...server, ...incoming];
  return combined.slice(-cap);
}

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

export const memoryRoutes = new Hono<AppEnv>();

/* ---- POST /api/v1/memory — Push + merge --------------------------------- */

memoryRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const requestedProjectId = asNonEmptyString(payload.projectId);
  const resolved = await resolveProjectForWrite(c, requestedProjectId);
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const projectId = resolved.projectId;
  const baseVersion = asInteger(payload.baseVersion, 0);
  const source = asNonEmptyString(payload.source) ?? "local";
  const globalPayload = isRecord(payload.global) ? payload.global : null;
  const packagesPayload = isRecord(payload.packages) ? payload.packages : null;

  /* -- Merge global memory ------------------------------------------------ */

  let mergedGlobal: {
    conventions: Record<string, unknown>;
    knownPatterns: KnownPattern[];
    failedPatterns: FailedPattern[];
    generationStats: GenerationStats;
  } | null = null;
  let globalVersion = 0;
  let didMerge = false;

  if (globalPayload) {
    const existing = await c.env.DB.prepare(
      `SELECT id, version, conventions, known_patterns AS knownPatterns,
              failed_patterns AS failedPatterns, generation_stats AS generationStats
       FROM project_memory WHERE project_id = ? LIMIT 1`
    )
      .bind(projectId)
      .first<Pick<ProjectMemoryRow, "id" | "version" | "conventions" | "knownPatterns" | "failedPatterns" | "generationStats">>();

    const incomingConventions = isRecord(globalPayload.conventions) ? globalPayload.conventions : {};
    const incomingKnown = Array.isArray(globalPayload.knownPatterns) ? (globalPayload.knownPatterns as KnownPattern[]) : [];
    const incomingFailed = Array.isArray(globalPayload.failedPatterns) ? (globalPayload.failedPatterns as FailedPattern[]) : [];
    const incomingStats = isRecord(globalPayload.generationStats) ? (globalPayload.generationStats as unknown as GenerationStats) : {
      total_runs: 0,
      successful_generations: 0,
      failed_generations: 0,
      total_tests_generated: 0,
      total_tests_passing: 0,
      last_run: ""
    };

    if (existing) {
      const serverKnown = parseJsonArray<KnownPattern>(existing.knownPatterns);
      const serverFailed = parseJsonArray<FailedPattern>(existing.failedPatterns);
      const serverStats = parseJsonObject(existing.generationStats) as unknown as GenerationStats;

      mergedGlobal = {
        conventions: incomingConventions,
        knownPatterns: mergeKnownPatterns(serverKnown, incomingKnown),
        failedPatterns: mergeFailedPatterns(serverFailed, incomingFailed),
        generationStats: mergeGenerationStats(serverStats, incomingStats)
      };
      globalVersion = existing.version + 1;
      didMerge = existing.version !== baseVersion;

      await c.env.DB.prepare(
        `UPDATE project_memory
         SET version = ?, conventions = ?, known_patterns = ?, failed_patterns = ?,
             generation_stats = ?, source = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
        .bind(
          globalVersion,
          JSON.stringify(mergedGlobal.conventions),
          JSON.stringify(mergedGlobal.knownPatterns),
          JSON.stringify(mergedGlobal.failedPatterns),
          JSON.stringify(mergedGlobal.generationStats),
          source,
          existing.id
        )
        .run();
    } else {
      mergedGlobal = {
        conventions: incomingConventions,
        knownPatterns: incomingKnown,
        failedPatterns: incomingFailed,
        generationStats: incomingStats
      };
      globalVersion = 1;

      const memoryId = crypto.randomUUID();
      await c.env.DB.prepare(
        `INSERT INTO project_memory (id, project_id, version, conventions, known_patterns,
                                     failed_patterns, generation_stats, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          memoryId,
          projectId,
          globalVersion,
          JSON.stringify(mergedGlobal.conventions),
          JSON.stringify(mergedGlobal.knownPatterns),
          JSON.stringify(mergedGlobal.failedPatterns),
          JSON.stringify(mergedGlobal.generationStats),
          source
        )
        .run();
    }
  }

  /* -- Merge package memories --------------------------------------------- */

  const mergedPackages: Record<string, {
    testPatterns: Record<string, unknown>;
    knownIssues: KnownIssue[];
    coverageHistory: unknown[];
    llmFeedback: unknown[];
  }> = {};

  if (packagesPayload) {
    for (const [packageName, pkgData] of Object.entries(packagesPayload)) {
      if (!isRecord(pkgData)) {
        continue;
      }

      const incomingTestPatterns = isRecord(pkgData.testPatterns) ? pkgData.testPatterns : {};
      const incomingIssues = Array.isArray(pkgData.knownIssues) ? (pkgData.knownIssues as KnownIssue[]) : [];
      const incomingCoverage = Array.isArray(pkgData.coverageHistory) ? (pkgData.coverageHistory as unknown[]) : [];
      const incomingFeedback = Array.isArray(pkgData.llmFeedback) ? (pkgData.llmFeedback as unknown[]) : [];

      const existing = await c.env.DB.prepare(
        `SELECT id, version, test_patterns AS testPatterns, known_issues AS knownIssues,
                coverage_history AS coverageHistory, llm_feedback AS llmFeedback
         FROM package_memory WHERE project_id = ? AND package_name = ? LIMIT 1`
      )
        .bind(projectId, packageName)
        .first<Pick<PackageMemoryRow, "id" | "version" | "testPatterns" | "knownIssues" | "coverageHistory" | "llmFeedback">>();

      if (existing) {
        const serverIssues = parseJsonArray<KnownIssue>(existing.knownIssues);
        const serverCoverage = parseJsonArray<unknown>(existing.coverageHistory);
        const serverFeedback = parseJsonArray<unknown>(existing.llmFeedback);

        const merged = {
          testPatterns: incomingTestPatterns,
          knownIssues: mergeKnownIssues(serverIssues, incomingIssues),
          coverageHistory: mergeAppendCapped(serverCoverage, incomingCoverage, MAX_HISTORY_ENTRIES),
          llmFeedback: mergeAppendCapped(serverFeedback, incomingFeedback, MAX_HISTORY_ENTRIES)
        };
        mergedPackages[packageName] = merged;

        await c.env.DB.prepare(
          `UPDATE package_memory
           SET version = version + 1, test_patterns = ?, known_issues = ?,
               coverage_history = ?, llm_feedback = ?, updated_at = datetime('now')
           WHERE id = ?`
        )
          .bind(
            JSON.stringify(merged.testPatterns),
            JSON.stringify(merged.knownIssues),
            JSON.stringify(merged.coverageHistory),
            JSON.stringify(merged.llmFeedback),
            existing.id
          )
          .run();
      } else {
        const merged = {
          testPatterns: incomingTestPatterns,
          knownIssues: incomingIssues,
          coverageHistory: incomingCoverage.slice(-MAX_HISTORY_ENTRIES),
          llmFeedback: incomingFeedback.slice(-MAX_HISTORY_ENTRIES)
        };
        mergedPackages[packageName] = merged;

        const pkgMemoryId = crypto.randomUUID();
        await c.env.DB.prepare(
          `INSERT INTO package_memory (id, project_id, package_name, version, test_patterns,
                                       known_issues, coverage_history, llm_feedback)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            pkgMemoryId,
            projectId,
            packageName,
            1,
            JSON.stringify(merged.testPatterns),
            JSON.stringify(merged.knownIssues),
            JSON.stringify(merged.coverageHistory),
            JSON.stringify(merged.llmFeedback)
          )
          .run();
      }
    }
  }

  return c.json(
    {
      version: globalVersion,
      merged: didMerge,
      global: mergedGlobal,
      packages: mergedPackages
    },
    201
  );
});

/* ---- GET /api/v1/memory — Pull ------------------------------------------ */

memoryRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const queryProjectId = asNonEmptyString(c.req.query("projectId"));
  if (!queryProjectId) {
    return c.json({ error: "projectId query parameter is required" }, 400);
  }

  if (!(await canAccessProject(c, queryProjectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  /* -- Load global memory ------------------------------------------------- */

  const globalRow = await c.env.DB.prepare(
    `SELECT version, conventions, known_patterns AS knownPatterns,
            failed_patterns AS failedPatterns, generation_stats AS generationStats
     FROM project_memory WHERE project_id = ? LIMIT 1`
  )
    .bind(queryProjectId)
    .first<Pick<ProjectMemoryRow, "version" | "conventions" | "knownPatterns" | "failedPatterns" | "generationStats">>();

  const globalData = globalRow
    ? {
        conventions: parseJsonObject(globalRow.conventions),
        knownPatterns: parseJsonArray<KnownPattern>(globalRow.knownPatterns),
        failedPatterns: parseJsonArray<FailedPattern>(globalRow.failedPatterns),
        generationStats: parseJsonObject(globalRow.generationStats)
      }
    : null;

  /* -- Load package memories ---------------------------------------------- */

  const pkgRows = await c.env.DB.prepare(
    `SELECT package_name AS packageName, test_patterns AS testPatterns,
            known_issues AS knownIssues, coverage_history AS coverageHistory,
            llm_feedback AS llmFeedback
     FROM package_memory WHERE project_id = ? ORDER BY package_name`
  )
    .bind(queryProjectId)
    .all<Pick<PackageMemoryRow, "packageName" | "testPatterns" | "knownIssues" | "coverageHistory" | "llmFeedback">>();

  const packages: Record<string, {
    testPatterns: Record<string, unknown>;
    knownIssues: unknown[];
    coverageHistory: unknown[];
    llmFeedback: unknown[];
  }> = {};

  for (const row of pkgRows.results) {
    packages[row.packageName] = {
      testPatterns: parseJsonObject(row.testPatterns),
      knownIssues: parseJsonArray(row.knownIssues),
      coverageHistory: parseJsonArray(row.coverageHistory),
      llmFeedback: parseJsonArray(row.llmFeedback)
    };
  }

  return c.json({
    version: globalRow?.version ?? 0,
    global: globalData,
    packages
  });
});

/* ---- DELETE /api/v1/memory — Reset -------------------------------------- */

memoryRoutes.delete("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const queryProjectId = asNonEmptyString(c.req.query("projectId"));
  if (!queryProjectId) {
    return c.json({ error: "projectId query parameter is required" }, 400);
  }

  const resolved = await resolveProjectForWrite(c, queryProjectId);
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const packageName = asNonEmptyString(c.req.query("packageName"));

  if (packageName) {
    await c.env.DB.prepare("DELETE FROM package_memory WHERE project_id = ? AND package_name = ?")
      .bind(resolved.projectId, packageName)
      .run();
  } else {
    await c.env.DB.prepare("DELETE FROM project_memory WHERE project_id = ?").bind(resolved.projectId).run();
    await c.env.DB.prepare("DELETE FROM package_memory WHERE project_id = ?").bind(resolved.projectId).run();
  }

  return c.json({ deleted: true });
});
