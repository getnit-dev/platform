import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { asNonEmptyString, asNumber, asInteger, isRecord, parseLimit } from "../lib/validation";
import type { AppEnv } from "../types";

export const riskRoutes = new Hono<AppEnv>();

riskRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const resolved = await resolveProjectForWrite(c, asNonEmptyString(payload.projectId));
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const runId = asNonEmptyString(payload.runId);
  const files = Array.isArray(payload.files) ? payload.files : [];

  if (files.length === 0) {
    return c.json({ error: "files array is required" }, 400);
  }

  const statements: D1PreparedStatement[] = [];

  for (const f of files) {
    if (!isRecord(f)) continue;

    const filePath = asNonEmptyString(f.filePath);
    if (!filePath) continue;

    const id = crypto.randomUUID();
    const criticalityDomains = Array.isArray(f.criticalityDomains)
      ? JSON.stringify(f.criticalityDomains)
      : asNonEmptyString(f.criticalityDomains);

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO risk_scores (id, project_id, run_id, file_path, overall_score, complexity_score, coverage_score, recency_score, criticality_score, level, criticality_domains, avg_complexity, coverage_percentage, function_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        resolved.projectId,
        runId,
        filePath,
        asNumber(f.overallScore),
        asNumber(f.complexityScore),
        asNumber(f.coverageScore),
        asNumber(f.recencyScore),
        asNumber(f.criticalityScore),
        asNonEmptyString(f.level),
        criticalityDomains,
        asNumber(f.avgComplexity),
        asNumber(f.coveragePercentage),
        asInteger(f.functionCount, 0) || null
      )
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({ inserted: statements.length }, 201);
});

riskRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  if (!(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const level = asNonEmptyString(c.req.query("level"));
  const limit = parseLimit(c.req.query("limit"), 100);

  let sql = `
    SELECT
      id, project_id AS projectId, run_id AS runId,
      file_path AS filePath, overall_score AS overallScore,
      complexity_score AS complexityScore, coverage_score AS coverageScore,
      recency_score AS recencyScore, criticality_score AS criticalityScore,
      level, criticality_domains AS criticalityDomains,
      avg_complexity AS avgComplexity, coverage_percentage AS coveragePercentage,
      function_count AS functionCount, created_at AS createdAt
    FROM risk_scores
    WHERE project_id = ?
  `;
  const binds: Array<string | number> = [projectId];

  if (level) {
    sql += " AND level = ?";
    binds.push(level);
  }

  sql += " ORDER BY overall_score DESC, created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ files: rows.results });
});

riskRoutes.get("/summary", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  if (!projectId) {
    return c.json({ error: "projectId is required" }, 400);
  }

  if (!(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const avgRow = await c.env.DB.prepare(
    "SELECT AVG(overall_score) AS avgScore FROM risk_scores WHERE project_id = ?"
  ).bind(projectId).first<{ avgScore: number | null }>();

  const levelRows = await c.env.DB.prepare(
    "SELECT level, COUNT(*) AS count FROM risk_scores WHERE project_id = ? GROUP BY level"
  ).bind(projectId).all<{ level: string; count: number }>();

  const topFiles = await c.env.DB.prepare(
    `SELECT file_path AS filePath, overall_score AS overallScore, level
     FROM risk_scores WHERE project_id = ?
     ORDER BY overall_score DESC LIMIT 10`
  ).bind(projectId).all<{ filePath: string; overallScore: number; level: string }>();

  const domainRows = await c.env.DB.prepare(
    "SELECT criticality_domains FROM risk_scores WHERE project_id = ? AND criticality_domains IS NOT NULL"
  ).bind(projectId).all<{ criticality_domains: string }>();

  const allDomains = new Set<string>();
  for (const row of domainRows.results) {
    try {
      const domains = JSON.parse(row.criticality_domains);
      if (Array.isArray(domains)) {
        domains.forEach((d: string) => allDomains.add(d));
      }
    } catch { /* skip invalid JSON */ }
  }

  const byLevel: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of levelRows.results) {
    const key = (row.level ?? "MEDIUM").toUpperCase();
    if (key in byLevel) {
      byLevel[key] = row.count;
    }
  }

  return c.json({
    avgScore: avgRow?.avgScore ?? 0,
    byLevel,
    topRiskyFiles: topFiles.results,
    criticalityDomains: Array.from(allDomains)
  });
});
