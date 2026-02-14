import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { asNonEmptyString, isRecord, parseLimit } from "../lib/validation";
import type { AppEnv } from "../types";

export const docCoverageRoutes = new Hono<AppEnv>();

docCoverageRoutes.post("/", async (c) => {
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
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO doc_coverage (id, project_id, run_id, file_path, function_name, has_docstring, is_stale, doc_framework)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        resolved.projectId,
        runId,
        filePath,
        asNonEmptyString(f.functionName),
        f.hasDocstring === true ? 1 : 0,
        f.isStale === true ? 1 : 0,
        asNonEmptyString(f.docFramework)
      )
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({ inserted: statements.length }, 201);
});

docCoverageRoutes.get("/", async (c) => {
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
  const isStale = c.req.query("isStale");
  const limit = parseLimit(c.req.query("limit"), 200);

  let sql = `
    SELECT
      id, project_id AS projectId, run_id AS runId,
      file_path AS filePath, function_name AS functionName,
      has_docstring AS hasDocstring, is_stale AS isStale,
      doc_framework AS docFramework, created_at AS createdAt
    FROM doc_coverage
    WHERE project_id = ?
  `;
  const binds: Array<string | number> = [projectId];

  if (runId) {
    sql += " AND run_id = ?";
    binds.push(runId);
  }
  if (isStale === "1" || isStale === "true") {
    sql += " AND is_stale = 1";
  }

  sql += " ORDER BY created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ files: rows.results });
});

docCoverageRoutes.get("/summary", async (c) => {
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

  const totalRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM doc_coverage WHERE project_id = ?"
  ).bind(projectId).first<{ total: number }>();

  const documentedRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM doc_coverage WHERE project_id = ? AND has_docstring = 1"
  ).bind(projectId).first<{ total: number }>();

  const staleRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM doc_coverage WHERE project_id = ? AND is_stale = 1"
  ).bind(projectId).first<{ total: number }>();

  const total = totalRow?.total ?? 0;
  const documented = documentedRow?.total ?? 0;

  return c.json({
    totalFiles: total,
    documented,
    undocumented: total - documented,
    stale: staleRow?.total ?? 0,
    coveragePercent: total > 0 ? Math.round((documented / total) * 1000) / 10 : 0
  });
});
