import type { AppBindings } from "../types";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export async function aggregateUsageDaily(env: Pick<AppBindings, "DB">): Promise<void> {
  const now = new Date();
  const end = now.toISOString();
  const endDate = end.slice(0, 10);

  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - 2);
  const start = startDate.toISOString();
  const startDay = start.slice(0, 10);

  await env.DB.prepare("DELETE FROM usage_daily WHERE date >= ? AND date <= ?")
    .bind(startDay, endDate)
    .run();

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
    `
  )
    .bind(start, end)
    .run();
}

export async function cleanupUsageData(env: Pick<AppBindings, "DB" | "USAGE_EVENTS_RETENTION_DAYS" | "USAGE_DAILY_RETENTION_DAYS">): Promise<void> {
  const eventRetentionDays = parsePositiveInt(env.USAGE_EVENTS_RETENTION_DAYS, 180);
  const dailyRetentionDays = parsePositiveInt(env.USAGE_DAILY_RETENTION_DAYS, 730);

  await env.DB.prepare(
    "DELETE FROM usage_events WHERE julianday(timestamp) < julianday('now') - ?"
  )
    .bind(eventRetentionDays)
    .run();

  await env.DB.prepare(
    "DELETE FROM usage_daily WHERE julianday(date) < julianday('now') - ?"
  )
    .bind(dailyRetentionDays)
    .run();
}
