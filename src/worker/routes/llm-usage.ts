import { Hono, type Context } from "hono";
import { userOwnsProject } from "../lib/access";
import type { AppEnv } from "../types";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseDays(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), 3650);
}

function getSessionUserId(c: Context<AppEnv>): string | null {
  const session = (c.var as Partial<AppEnv["Variables"]>).auth;
  return session?.userId ?? null;
}

async function assertProjectAccess(
  c: Context<AppEnv>,
  userId: string,
  projectId: string | null
): Promise<boolean> {
  if (!projectId) {
    return true;
  }

  return userOwnsProject(c.env, userId, projectId);
}

export const llmUsageRoutes = new Hono<AppEnv>();

llmUsageRoutes.get("/summary", async (c) => {
  const userId = getSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  if (!(await assertProjectAccess(c, userId, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const days = parseDays(c.req.query("days"), 30);

  let sql = `
    SELECT
      COUNT(*) AS totalRequests,
      SUM(prompt_tokens + completion_tokens) AS totalTokens,
      SUM(cost_usd) AS totalCostUsd
    FROM usage_events
    WHERE user_id = ?
      AND timestamp >= datetime('now', ?)
  `;
  const binds: Array<string> = [userId, `-${days} days`];

  if (projectId) {
    sql += " AND project_id = ?";
    binds.push(projectId);
  }

  const summary = await c.env.DB.prepare(sql).bind(...binds).first<{
    totalRequests: number | null;
    totalTokens: number | null;
    totalCostUsd: number | null;
  }>();

  return c.json({
    summary: {
      totalRequests: Number(summary?.totalRequests ?? 0),
      totalTokens: Number(summary?.totalTokens ?? 0),
      totalCostUsd: Number(summary?.totalCostUsd ?? 0)
    }
  });
});

llmUsageRoutes.get("/daily", async (c) => {
  const userId = getSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  if (!(await assertProjectAccess(c, userId, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const days = parseDays(c.req.query("days"), 30);

  let sql = `
    SELECT
      date,
      SUM(total_requests) AS totalRequests,
      SUM(total_tokens) AS totalTokens,
      SUM(total_cost_usd) AS totalCostUsd
    FROM usage_daily
    WHERE user_id = ?
      AND date >= date('now', ?)
  `;
  const binds: Array<string> = [userId, `-${days} days`];

  if (projectId) {
    sql += " AND project_id = ?";
    binds.push(projectId);
  }

  sql += " GROUP BY date ORDER BY date ASC";

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<{
    date: string;
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
  }>();

  return c.json({ daily: rows.results });
});

llmUsageRoutes.get("/breakdown", async (c) => {
  const userId = getSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  if (!(await assertProjectAccess(c, userId, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const days = parseDays(c.req.query("days"), 30);

  let sql = `
    SELECT
      provider,
      model,
      COUNT(*) AS requests,
      SUM(prompt_tokens + completion_tokens) AS tokens,
      SUM(cost_usd) AS totalCostUsd
    FROM usage_events
    WHERE user_id = ?
      AND timestamp >= datetime('now', ?)
  `;
  const binds: Array<string> = [userId, `-${days} days`];

  if (projectId) {
    sql += " AND project_id = ?";
    binds.push(projectId);
  }

  sql += " GROUP BY provider, model ORDER BY totalCostUsd DESC";

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<{
    provider: string;
    model: string;
    requests: number;
    tokens: number;
    totalCostUsd: number;
  }>();

  return c.json({ breakdown: rows.results });
});
