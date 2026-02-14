import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { actorSource, logActivity } from "../lib/activity";
import { asNonEmptyString, asNumber, isRecord, parseLimit } from "../lib/validation";
import type { AppEnv } from "../types";

export const routeDiscoveryRoutes = new Hono<AppEnv>();

routeDiscoveryRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const resolved = await resolveProjectForWrite(c, asNonEmptyString(payload.projectId));
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const runId = asNonEmptyString(payload.runId);
  const routes = Array.isArray(payload.routes) ? payload.routes : [];

  if (routes.length === 0) {
    return c.json({ error: "routes array is required" }, 400);
  }

  const statements: D1PreparedStatement[] = [];

  for (const r of routes) {
    if (!isRecord(r)) continue;

    const path = asNonEmptyString(r.path);
    if (!path) continue;

    const id = crypto.randomUUID();
    const methods = Array.isArray(r.methods) ? JSON.stringify(r.methods) : asNonEmptyString(r.methods);
    const params = Array.isArray(r.params) ? JSON.stringify(r.params) : asNonEmptyString(r.params);
    const middleware = Array.isArray(r.middleware) ? JSON.stringify(r.middleware) : asNonEmptyString(r.middleware);

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO routes (id, project_id, run_id, path, route_type, methods, handler_file, handler_name, handler_start_line, handler_end_line, params, framework, middleware, auth_required, coverage_percentage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        resolved.projectId,
        runId,
        path,
        asNonEmptyString(r.routeType),
        methods,
        asNonEmptyString(r.handlerFile),
        asNonEmptyString(r.handlerName),
        asNumber(r.handlerStartLine),
        asNumber(r.handlerEndLine),
        params,
        asNonEmptyString(r.framework),
        middleware,
        r.authRequired === true ? 1 : r.authRequired === false ? 0 : null,
        asNumber(r.coveragePercentage)
      )
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  logActivity({
    db: c.env.DB,
    projectId: resolved.projectId,
    eventType: "routes_discovered",
    source: actorSource(resolved.actor),
    summary: `${statements.length} route(s) discovered`,
    metadata: { count: statements.length, runId }
  });

  return c.json({ inserted: statements.length }, 201);
});

routeDiscoveryRoutes.get("/", async (c) => {
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

  const routeType = asNonEmptyString(c.req.query("routeType"));
  const framework = asNonEmptyString(c.req.query("framework"));
  const limit = parseLimit(c.req.query("limit"), 200);

  let sql = `
    SELECT
      id, project_id AS projectId, run_id AS runId,
      path, route_type AS routeType, methods,
      handler_file AS handlerFile, handler_name AS handlerName,
      handler_start_line AS handlerStartLine, handler_end_line AS handlerEndLine,
      params, framework, middleware,
      auth_required AS authRequired, coverage_percentage AS coveragePercentage,
      created_at AS createdAt
    FROM routes
    WHERE project_id = ?
  `;
  const binds: Array<string | number> = [projectId];

  if (routeType) {
    sql += " AND route_type = ?";
    binds.push(routeType);
  }
  if (framework) {
    sql += " AND framework = ?";
    binds.push(framework);
  }

  sql += " ORDER BY path ASC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all();
  return c.json({ routes: rows.results });
});

routeDiscoveryRoutes.get("/summary", async (c) => {
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
    "SELECT COUNT(*) AS total FROM routes WHERE project_id = ?"
  ).bind(projectId).first<{ total: number }>();

  const coveredRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS total FROM routes WHERE project_id = ? AND coverage_percentage > 0"
  ).bind(projectId).first<{ total: number }>();

  const typeRows = await c.env.DB.prepare(
    "SELECT route_type AS type, COUNT(*) AS count FROM routes WHERE project_id = ? GROUP BY route_type"
  ).bind(projectId).all<{ type: string; count: number }>();

  const uncovered = await c.env.DB.prepare(
    `SELECT path, methods FROM routes
     WHERE project_id = ? AND (coverage_percentage IS NULL OR coverage_percentage = 0)
     ORDER BY path ASC LIMIT 20`
  ).bind(projectId).all<{ path: string; methods: string }>();

  const byType: Record<string, number> = {};
  for (const row of typeRows.results) {
    byType[(row.type ?? "unknown").toLowerCase()] = row.count;
  }

  return c.json({
    totalRoutes: totalRow?.total ?? 0,
    coveredRoutes: coveredRow?.total ?? 0,
    byType,
    uncoveredRoutes: uncovered.results
  });
});
