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

export async function aggregateDriftDaily(env: Pick<AppBindings, "DB" | "KV">): Promise<void> {
  const rows = await env.DB.prepare(
    `
      SELECT
        substr(created_at, 1, 10) AS date,
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'drifted' THEN 1 ELSE 0 END) AS drifted,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
        AVG(similarity_score) AS avgSimilarity
      FROM drift_results
      WHERE created_at >= datetime('now', '-2 days')
      GROUP BY substr(created_at, 1, 10)
    `
  ).all<{
    date: string;
    total: number;
    drifted: number;
    errors: number;
    avgSimilarity: number | null;
  }>();

  for (const row of rows.results) {
    const key = `drift:daily:${row.date}`;
    await env.KV.put(key, JSON.stringify(row), { expirationTtl: 60 * 60 * 24 * 400 });
  }
}

export async function cleanupDriftData(
  env: Pick<AppBindings, "DB" | "DRIFT_RETENTION_DAYS">
): Promise<void> {
  const retentionDays = parsePositiveInt(env.DRIFT_RETENTION_DAYS, 365);

  await env.DB.prepare(
    "DELETE FROM drift_results WHERE julianday(created_at) < julianday('now') - ?"
  )
    .bind(retentionDays)
    .run();
}
