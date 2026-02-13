import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { asNonEmptyString, isRecord, parseLimit } from "../lib/validation";
import type { AppEnv } from "../types";

interface BugRow {
  id: string;
  projectId: string;
  packageId: string | null;
  filePath: string;
  functionName: string | null;
  description: string;
  rootCause: string | null;
  severity: string;
  status: string;
  githubIssueUrl: string | null;
  githubPrUrl: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const bugRoutes = new Hono<AppEnv>();

bugRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const resolved = await resolveProjectForWrite(c, asNonEmptyString(payload.projectId));
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const filePath = asNonEmptyString(payload.filePath);
  const description = asNonEmptyString(payload.description);

  if (!filePath || !description) {
    return c.json({ error: "filePath and description are required" }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `
      INSERT INTO bugs (
        id,
        project_id,
        package_id,
        file_path,
        function_name,
        description,
        root_cause,
        severity,
        status,
        github_issue_url,
        github_pr_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      id,
      resolved.projectId,
      asNonEmptyString(payload.packageId),
      filePath,
      asNonEmptyString(payload.functionName),
      description,
      asNonEmptyString(payload.rootCause),
      asNonEmptyString(payload.severity) ?? "medium",
      asNonEmptyString(payload.status) ?? "open",
      asNonEmptyString(payload.githubIssueUrl),
      asNonEmptyString(payload.githubPrUrl)
    )
    .run();

  return c.json({ bugId: id }, 201);
});

bugRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  const status = asNonEmptyString(c.req.query("status"));
  const severity = asNonEmptyString(c.req.query("severity"));
  const limit = parseLimit(c.req.query("limit"), 100);

  if (projectId && !(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  let sql = `
    SELECT
      b.id AS id,
      b.project_id AS projectId,
      b.package_id AS packageId,
      b.file_path AS filePath,
      b.function_name AS functionName,
      b.description AS description,
      b.root_cause AS rootCause,
      b.severity AS severity,
      b.status AS status,
      b.github_issue_url AS githubIssueUrl,
      b.github_pr_url AS githubPrUrl,
      b.created_at AS createdAt,
      b.resolved_at AS resolvedAt
    FROM bugs b
    INNER JOIN projects p ON p.id = b.project_id
    WHERE p.user_id = ?
  `;
  const binds: Array<string | number> = [actor.userId];

  if (projectId) {
    sql += " AND b.project_id = ?";
    binds.push(projectId);
  }

  if (actor.mode === "api-key" && actor.projectId) {
    sql += " AND b.project_id = ?";
    binds.push(actor.projectId);
  }

  if (status) {
    sql += " AND b.status = ?";
    binds.push(status);
  }

  if (severity) {
    sql += " AND b.severity = ?";
    binds.push(severity);
  }

  sql += " ORDER BY b.created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<BugRow>();
  return c.json({ bugs: rows.results });
});

bugRoutes.patch("/:bugId", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const bugId = c.req.param("bugId");
  const payload = await c.req.json<unknown>();

  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const existing = await c.env.DB.prepare(
    `
      SELECT b.project_id AS projectId
      FROM bugs b
      INNER JOIN projects p ON p.id = b.project_id
      WHERE b.id = ? AND p.user_id = ?
      LIMIT 1
    `
  )
    .bind(bugId, actor.userId)
    .first<{ projectId: string }>();

  if (!existing) {
    return c.json({ error: "Bug not found" }, 404);
  }

  const updates: string[] = [];
  const binds: Array<string | null> = [];

  const status = asNonEmptyString(payload.status);
  if (status) {
    updates.push("status = ?");
    binds.push(status);

    if (["fixed", "wont_fix", "false_positive"].includes(status)) {
      updates.push("resolved_at = datetime('now')");
    }
  }

  if ("githubIssueUrl" in payload) {
    updates.push("github_issue_url = ?");
    binds.push(asNonEmptyString(payload.githubIssueUrl));
  }

  if ("githubPrUrl" in payload) {
    updates.push("github_pr_url = ?");
    binds.push(asNonEmptyString(payload.githubPrUrl));
  }

  if (updates.length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  const result = await c.env.DB.prepare(
    `
      UPDATE bugs
      SET ${updates.join(", ")}
      WHERE id = ?
    `
  )
    .bind(...binds, bugId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Bug not found" }, 404);
  }

  return c.json({ updated: true });
});
