import type { AppBindings } from "../types";

const PERIOD_KEYS = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly"
} as const;

type BudgetPeriod = keyof typeof PERIOD_KEYS;

function getUtcParts(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return { year, month, day };
}

function getIsoWeek(date: Date): string {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function markerForPeriod(period: BudgetPeriod, now: Date): string {
  const { year, month, day } = getUtcParts(now);

  if (period === "daily") {
    return `${year}-${month}-${day}`;
  }

  if (period === "weekly") {
    return getIsoWeek(now);
  }

  return `${year}-${month}`;
}

function ttlForPeriod(period: BudgetPeriod): number {
  if (period === "daily") {
    return 60 * 60 * 48;
  }

  if (period === "weekly") {
    return 60 * 60 * 24 * 14;
  }

  return 60 * 60 * 24 * 62;
}

async function resetPeriodIfNeeded(
  env: Pick<AppBindings, "DB" | "KV">,
  period: BudgetPeriod,
  now: Date
): Promise<number> {
  const marker = markerForPeriod(period, now);
  const markerKey = `budget_reset:${period}:${marker}`;

  const alreadyRan = await env.KV.get(markerKey);
  if (alreadyRan) {
    return 0;
  }

  const result = await env.DB.prepare(
    "UPDATE virtual_keys SET spend_total = 0 WHERE budget_duration = ? AND revoked = 0"
  )
    .bind(period)
    .run();

  await env.KV.put(markerKey, "1", { expirationTtl: ttlForPeriod(period) });

  return Number(result.meta?.changes ?? 0);
}

export async function resetVirtualKeyBudgets(env: Pick<AppBindings, "DB" | "KV">): Promise<void> {
  const now = new Date();

  await resetPeriodIfNeeded(env, PERIOD_KEYS.daily, now);
  await resetPeriodIfNeeded(env, PERIOD_KEYS.weekly, now);
  await resetPeriodIfNeeded(env, PERIOD_KEYS.monthly, now);
}
