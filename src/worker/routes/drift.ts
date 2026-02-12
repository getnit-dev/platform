import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import type { AppEnv } from "../types";

interface DriftRow {
  id: string;
  projectId: string;
  testName: string;
  status: string;
  similarityScore: number | null;
  baselineOutput: string | null;
  currentOutput: string | null;
  details: string | null;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseLimit(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), 200);
}

export const driftRoutes = new Hono<AppEnv>();

driftRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();

  const entries = (() => {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (isRecord(payload) && Array.isArray(payload.results)) {
      return payload.results;
    }

    return [payload];
  })();

  const insertedIds: string[] = [];

  const rootProjectId = isRecord(payload) ? asNonEmptyString(payload.projectId) : null;

  for (const raw of entries) {
    if (!isRecord(raw)) {
      continue;
    }

    const requestedProjectId = asNonEmptyString(raw.projectId) ?? rootProjectId;
    const resolved = await resolveProjectForWrite(c, requestedProjectId);
    if (!resolved) {
      continue;
    }

    const testName = asNonEmptyString(raw.testName) ?? asNonEmptyString(raw.name) ?? "unnamed-drift-test";
    const status = asNonEmptyString(raw.status) ?? "error";
    const similarityScore = asFiniteNumber(raw.similarityScore);
    const baselineOutput = asNonEmptyString(raw.baselineOutput);
    const currentOutput = asNonEmptyString(raw.currentOutput);
    const details = raw.details === undefined ? null : JSON.stringify(raw.details);

    const id = crypto.randomUUID();
    insertedIds.push(id);

    await c.env.DB.prepare(
      `
        INSERT INTO drift_results (
          id,
          project_id,
          test_name,
          status,
          similarity_score,
          baseline_output,
          current_output,
          details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
      .bind(
        id,
        resolved.projectId,
        testName,
        status,
        similarityScore,
        baselineOutput,
        currentOutput,
        details
      )
      .run();
  }

  if (insertedIds.length === 0) {
    return c.json({ error: "No valid drift results to insert" }, 400);
  }

  return c.json({ inserted: insertedIds.length, ids: insertedIds }, 201);
});

driftRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  const status = asNonEmptyString(c.req.query("status"));
  const limit = parseLimit(c.req.query("limit"), 100);

  let sql = `
    SELECT
      dr.id AS id,
      dr.project_id AS projectId,
      dr.test_name AS testName,
      dr.status AS status,
      dr.similarity_score AS similarityScore,
      dr.baseline_output AS baselineOutput,
      dr.current_output AS currentOutput,
      dr.details AS details,
      dr.created_at AS createdAt
    FROM drift_results dr
    INNER JOIN projects p ON p.id = dr.project_id
    WHERE p.user_id = ?
  `;
  const binds: Array<string | number> = [actor.userId];

  if (projectId) {
    if (!(await canAccessProject(c, projectId))) {
      return c.json({ error: "Project access denied" }, 403);
    }

    sql += " AND dr.project_id = ?";
    binds.push(projectId);
  }

  if (actor.mode === "api-key" && actor.projectId) {
    sql += " AND dr.project_id = ?";
    binds.push(actor.projectId);
  }

  if (status) {
    sql += " AND dr.status = ?";
    binds.push(status);
  }

  sql += " ORDER BY dr.created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<DriftRow>();
  return c.json({ results: rows.results });
});

driftRoutes.get("/timeline", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  const daysRaw = c.req.query("days");
  const days = parseLimit(daysRaw, 30);

  if (projectId && !(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  let sql = `
    SELECT
      substr(dr.created_at, 1, 10) AS date,
      COUNT(*) AS total,
      SUM(CASE WHEN dr.status = 'drifted' THEN 1 ELSE 0 END) AS drifted,
      AVG(dr.similarity_score) AS avgSimilarity
    FROM drift_results dr
    INNER JOIN projects p ON p.id = dr.project_id
    WHERE p.user_id = ?
      AND dr.created_at >= datetime('now', ?)
  `;
  const binds: Array<string> = [actor.userId, `-${days} days`];

  if (projectId) {
    sql += " AND dr.project_id = ?";
    binds.push(projectId);
  }

  if (actor.mode === "api-key" && actor.projectId) {
    sql += " AND dr.project_id = ?";
    binds.push(actor.projectId);
  }

  sql += " GROUP BY substr(dr.created_at, 1, 10) ORDER BY date ASC";

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<{
    date: string;
    total: number;
    drifted: number;
    avgSimilarity: number | null;
  }>();

  return c.json({ timeline: rows.results });
});
