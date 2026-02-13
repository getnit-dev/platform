import type { AppBindings } from "../types";
import { parsePositiveInt } from "./validation";

export async function aggregateUsageDaily(env: Pick<AppBindings, "DB">): Promise<void> {
  const now = new Date();
  const end = now.toISOString();

  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - 2);
  const start = startDate.toISOString();

  await env.DB.prepare(
    `
      INSERT INTO usage_daily (
        id,
        user_id,
        project_id,
        model,
        date,
        total_requests,
        total_tokens,
        total_cost_usd,
        created_at,
        updated_at
      )
      SELECT
        lower(hex(randomblob(16))),
        user_id,
        project_id,
        model,
        substr(timestamp, 1, 10),
        COUNT(*),
        SUM(prompt_tokens + completion_tokens),
        SUM(cost_usd),
        datetime('now'),
        datetime('now')
      FROM usage_events
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY user_id, project_id, model, substr(timestamp, 1, 10)
      ON CONFLICT (user_id, project_id, model, date) DO UPDATE SET
        total_requests = excluded.total_requests,
        total_tokens = excluded.total_tokens,
        total_cost_usd = excluded.total_cost_usd,
        updated_at = datetime('now')
    `
  )
    .bind(start, end)
    .run();
}

export async function cleanupUsageData(env: Pick<AppBindings, "DB" | "USAGE_EVENTS_RETENTION_DAYS" | "USAGE_DAILY_RETENTION_DAYS">): Promise<void> {
  const eventRetentionDays = parsePositiveInt(env.USAGE_EVENTS_RETENTION_DAYS, 180);
  const dailyRetentionDays = parsePositiveInt(env.USAGE_DAILY_RETENTION_DAYS, 730);

  await env.DB.prepare(
    "DELETE FROM usage_events WHERE timestamp < datetime('now', ?)"
  )
    .bind(`-${eventRetentionDays} days`)
    .run();

  await env.DB.prepare(
    "DELETE FROM usage_daily WHERE date < date('now', ?)"
  )
    .bind(`-${dailyRetentionDays} days`)
    .run();
}
