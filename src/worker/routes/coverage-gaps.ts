import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { asNonEmptyString, asNumber, asInteger, isRecord, parseLimit } from "../lib/validation";
import type { AppEnv } from "../types";

interface CoverageGapRow {
  id: string;
  projectId: string;
  runId: string | null;
  filePath: string;
  functionName: string;
  lineNumber: number | null;
  endLine: number | null;
  coveragePercentage: number | null;
  complexity: number | null;
  isPublic: boolean | null;
  priority: string | null;
  createdAt: string;
}

export const coverageGapRoutes = new Hono<AppEnv>();

coverageGapRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const resolved = await resolveProjectForWrite(c, asNonEmptyString(payload.projectId));
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const runId = asNonEmptyString(payload.runId);
  const gaps = Array.isArray(payload.gaps) ? payload.gaps : [];

  if (gaps.length === 0) {
    return c.json({ error: "gaps array is required" }, 400);
  }

  const statements: D1PreparedStatement[] = [];

  for (const gap of gaps) {
    if (!isRecord(gap)) continue;

    const filePath = asNonEmptyString(gap.filePath);
    const functionName = asNonEmptyString(gap.functionName);
    if (!filePath || !functionName) continue;

    const id = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO coverage_gaps (id, project_id, run_id, file_path, function_name, line_number, end_line, coverage_percentage, complexity, is_public, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        resolved.projectId,
        runId,
        filePath,
        functionName,
        asInteger(gap.lineNumber, 0) || null,
        asInteger(gap.endLine, 0) || null,
        asNumber(gap.coveragePercentage),
        asInteger(gap.complexity, 0) || null,
        gap.isPublic === true ? 1 : gap.isPublic === false ? 0 : null,
        asNonEmptyString(gap.priority)
      )
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({ inserted: statements.length }, 201);
});

coverageGapRoutes.get("/", async (c) => {
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

  const runId = asNonEmptyString(c.req.query("runId"));
  const priority = asNonEmptyString(c.req.query("priority"));
  const filePath = asNonEmptyString(c.req.query("filePath"));
  const limit = parseLimit(c.req.query("limit"), 200);

  let sql = `
    SELECT
      id, project_id AS projectId, run_id AS runId,
      file_path AS filePath, function_name AS functionName,
      line_number AS lineNumber, end_line AS endLine,
      coverage_percentage AS coveragePercentage, complexity,
      is_public AS isPublic, priority, created_at AS createdAt
    FROM coverage_gaps
    WHERE project_id = ?
  `;
  const binds: Array<string | number> = [projectId];

  if (runId) {
    sql += " AND run_id = ?";
    binds.push(runId);
  }
  if (priority) {
    sql += " AND priority = ?";
    binds.push(priority);
  }
  if (filePath) {
    sql += " AND file_path = ?";
    binds.push(filePath);
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<CoverageGapRow>();
  return c.json({ gaps: rows.results });
});

coverageGapRoutes.get("/summary", async (c) => {
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

  const runId = asNonEmptyString(c.req.query("runId"));

  let whereClause = "WHERE project_id = ?";
  const binds: Array<string | number> = [projectId];

  if (runId) {
    whereClause += " AND run_id = ?";
    binds.push(runId);
  }

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM coverage_gaps ${whereClause}`
  ).bind(...binds).first<{ total: number }>();

  const priorityRows = await c.env.DB.prepare(
    `SELECT priority, COUNT(*) AS count FROM coverage_gaps ${whereClause} GROUP BY priority`
  ).bind(...binds).all<{ priority: string; count: number }>();

  const untestedRow = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT file_path) AS count FROM coverage_gaps ${whereClause} AND coverage_percentage = 0`
  ).bind(...binds).first<{ count: number }>();

  const topFiles = await c.env.DB.prepare(
    `SELECT file_path AS filePath, COUNT(*) AS gapCount, AVG(complexity) AS avgComplexity
     FROM coverage_gaps ${whereClause}
     GROUP BY file_path ORDER BY gapCount DESC LIMIT 10`
  ).bind(...binds).all<{ filePath: string; gapCount: number; avgComplexity: number }>();

  const byPriority: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of priorityRows.results) {
    const key = (row.priority ?? "medium").toLowerCase();
    if (key in byPriority) {
      byPriority[key] = row.count;
    }
  }

  return c.json({
    totalGaps: totalRow?.total ?? 0,
    byPriority,
    untestedFiles: untestedRow?.count ?? 0,
    topFiles: topFiles.results
  });
});
