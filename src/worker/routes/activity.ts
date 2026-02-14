import { Hono } from "hono";
import { getRequestActor } from "../lib/access";
import { asNonEmptyString, parseLimit, parsePositiveInt } from "../lib/validation";
import type { AppEnv } from "../types";

interface ActivityEventRow {
  id: string;
  projectId: string;
  eventType: string;
  source: string | null;
  summary: string | null;
  metadata: string | null;
  createdAt: string;
  projectName: string | null;
}

export const activityRoutes = new Hono<AppEnv>();

activityRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  const eventType = asNonEmptyString(c.req.query("eventType"));
  const days = parsePositiveInt(c.req.query("days"), 7);
  const limit = parseLimit(c.req.query("limit"), 50);

  let sql = `
    SELECT
      al.id AS id,
      al.project_id AS projectId,
      al.event_type AS eventType,
      al.source AS source,
      al.summary AS summary,
      al.metadata AS metadata,
      al.created_at AS createdAt,
      p.name AS projectName
    FROM activity_log al
    INNER JOIN projects p ON p.id = al.project_id
    WHERE p.user_id = ?
      AND al.created_at >= datetime('now', '-' || ? || ' days')
  `;
  const binds: Array<string | number> = [actor.userId, days];

  if (projectId) {
    sql += " AND al.project_id = ?";
    binds.push(projectId);
  }

  if (eventType) {
    sql += " AND al.event_type = ?";
    binds.push(eventType);
  }

  sql += " ORDER BY al.created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<ActivityEventRow>();
  return c.json({ events: rows.results });
});
