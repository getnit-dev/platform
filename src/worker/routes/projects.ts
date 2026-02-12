import { Hono } from "hono";
import { getRequestActor } from "../lib/access";
import type { AppEnv } from "../types";

interface ProjectRow {
  id: string;
  userId: string;
  name: string;
  repoUrl: string | null;
  repoProvider: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  totalRuns?: number;
  detectedBugs?: number;
  createdIssues?: number;
  createdPRs?: number;
  totalCommits?: number;
  totalTokens?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor || actor.mode !== "session") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const rows = await c.env.DB.prepare(
    `
      SELECT
        p.id,
        p.user_id AS userId,
        p.name,
        p.repo_url AS repoUrl,
        p.repo_provider AS repoProvider,
        p.default_branch AS defaultBranch,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        COALESCE(r.totalRuns, 0) AS totalRuns,
        COALESCE(b.detectedBugs, 0) AS detectedBugs,
        COALESCE(b.createdIssues, 0) AS createdIssues,
        COALESCE(b.createdPRs, 0) AS createdPRs,
        COALESCE(r.totalCommits, 0) AS totalCommits,
        COALESCE(r.totalTokens, 0) AS totalTokens
      FROM projects p
      LEFT JOIN (
        SELECT
          project_id,
          COUNT(*) AS totalRuns,
          COUNT(DISTINCT commit_sha) AS totalCommits,
          SUM(COALESCE(llm_total_tokens, 0)) AS totalTokens
        FROM coverage_reports
        WHERE commit_sha IS NOT NULL
        GROUP BY project_id
      ) r ON p.id = r.project_id
      LEFT JOIN (
        SELECT
          project_id,
          COUNT(*) AS detectedBugs,
          COUNT(CASE WHEN github_issue_url IS NOT NULL THEN 1 END) AS createdIssues,
          COUNT(CASE WHEN github_pr_url IS NOT NULL THEN 1 END) AS createdPRs
        FROM bugs
        GROUP BY project_id
      ) b ON p.id = b.project_id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
    `
  )
    .bind(actor.userId)
    .all<ProjectRow>();

  return c.json({ projects: rows.results });
});

projectRoutes.post("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor || actor.mode !== "session") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const name = asNonEmptyString(payload.name);
  if (!name) {
    return c.json({ error: "Project name is required" }, 400);
  }

  const projectId = crypto.randomUUID();
  const repoUrl = asNonEmptyString(payload.repoUrl);
  const repoProvider = asNonEmptyString(payload.repoProvider) ?? "github";
  const defaultBranch = asNonEmptyString(payload.defaultBranch) ?? "main";

  await c.env.DB.prepare(
    `
      INSERT INTO projects (
        id,
        user_id,
        name,
        repo_url,
        repo_provider,
        default_branch
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
  )
    .bind(projectId, actor.userId, name, repoUrl, repoProvider, defaultBranch)
    .run();

  return c.json(
    {
      project: {
        id: projectId,
        name,
        repoUrl,
        repoProvider,
        defaultBranch
      }
    },
    201
  );
});

projectRoutes.get("/:projectId", async (c) => {
  const actor = getRequestActor(c);
  if (!actor || actor.mode !== "session") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = c.req.param("projectId");

  const row = await c.env.DB.prepare(
    `
      SELECT
        p.id,
        p.user_id AS userId,
        p.name,
        p.repo_url AS repoUrl,
        p.repo_provider AS repoProvider,
        p.default_branch AS defaultBranch,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        COALESCE(r.totalRuns, 0) AS totalRuns,
        COALESCE(b.detectedBugs, 0) AS detectedBugs,
        COALESCE(b.createdIssues, 0) AS createdIssues,
        COALESCE(b.createdPRs, 0) AS createdPRs,
        COALESCE(r.totalCommits, 0) AS totalCommits,
        COALESCE(r.totalTokens, 0) AS totalTokens
      FROM projects p
      LEFT JOIN (
        SELECT
          project_id,
          COUNT(*) AS totalRuns,
          COUNT(DISTINCT commit_sha) AS totalCommits,
          SUM(COALESCE(llm_total_tokens, 0)) AS totalTokens
        FROM coverage_reports
        WHERE commit_sha IS NOT NULL
        GROUP BY project_id
      ) r ON p.id = r.project_id
      LEFT JOIN (
        SELECT
          project_id,
          COUNT(*) AS detectedBugs,
          COUNT(CASE WHEN github_issue_url IS NOT NULL THEN 1 END) AS createdIssues,
          COUNT(CASE WHEN github_pr_url IS NOT NULL THEN 1 END) AS createdPRs
        FROM bugs
        GROUP BY project_id
      ) b ON p.id = b.project_id
      WHERE p.id = ? AND p.user_id = ?
      LIMIT 1
    `
  )
    .bind(projectId, actor.userId)
    .first<ProjectRow>();

  if (!row) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json({ project: row });
});

projectRoutes.patch("/:projectId", async (c) => {
  const actor = getRequestActor(c);
  if (!actor || actor.mode !== "session") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = c.req.param("projectId");
  const payload = await c.req.json<unknown>();

  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const updates: string[] = [];
  const values: Array<string | null> = [];

  const name = asNonEmptyString(payload.name);
  if (name) {
    updates.push("name = ?");
    values.push(name);
  }

  if ("repoUrl" in payload) {
    updates.push("repo_url = ?");
    values.push(asNonEmptyString(payload.repoUrl));
  }

  const repoProvider = asNonEmptyString(payload.repoProvider);
  if (repoProvider) {
    updates.push("repo_provider = ?");
    values.push(repoProvider);
  }

  const defaultBranch = asNonEmptyString(payload.defaultBranch);
  if (defaultBranch) {
    updates.push("default_branch = ?");
    values.push(defaultBranch);
  }

  if (updates.length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  updates.push("updated_at = datetime('now')");

  const result = await c.env.DB.prepare(
    `
      UPDATE projects
      SET ${updates.join(", ")}
      WHERE id = ? AND user_id = ?
    `
  )
    .bind(...values, projectId, actor.userId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json({ updated: true });
});

projectRoutes.delete("/:projectId", async (c) => {
  const actor = getRequestActor(c);
  if (!actor || actor.mode !== "session") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = c.req.param("projectId");

  const result = await c.env.DB.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
    .bind(projectId, actor.userId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json({ deleted: true });
});
