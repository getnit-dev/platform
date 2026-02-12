import type { UsageEvent } from "../types";

type UsageSource = UsageEvent["source"];

interface UsageDefaults {
  userId?: string;
  projectId?: string | null;
  keyHash?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    return lowered === "1" || lowered === "true" || lowered === "yes";
  }

  return false;
}

function coerceSource(value: unknown, fallback: UsageSource): UsageSource {
  if (value === "byok" || value === "cli") {
    return value;
  }

  return fallback;
}

function coerceTimestamp(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date().toISOString();
}

export function normalizeUsageEvent(
  input: unknown,
  fallbackSource: UsageSource,
  defaults?: UsageDefaults
): UsageEvent | null {
  if (!isRecord(input)) {
    return null;
  }

  const userId = typeof input.userId === "string"
    ? input.userId.trim()
    : typeof defaults?.userId === "string"
      ? defaults.userId.trim()
      : "";
  if (!userId) {
    return null;
  }

  const projectId = typeof input.projectId === "string" && input.projectId.trim()
    ? input.projectId.trim()
    : typeof defaults?.projectId === "string" && defaults.projectId.trim()
      ? defaults.projectId.trim()
    : null;

  const keyHash = typeof input.keyHash === "string" && input.keyHash.trim()
    ? input.keyHash.trim()
    : typeof defaults?.keyHash === "string" && defaults.keyHash.trim()
      ? defaults.keyHash.trim()
    : null;

  const model = typeof input.model === "string" && input.model.trim()
    ? input.model.trim()
    : "unknown";

  const provider = typeof input.provider === "string" && input.provider.trim()
    ? input.provider.trim().toLowerCase()
    : "unknown";

  const promptTokens = Math.max(0, Math.floor(parseFiniteNumber(input.promptTokens) ?? 0));
  const completionTokens = Math.max(0, Math.floor(parseFiniteNumber(input.completionTokens) ?? 0));
  const costUsd = Math.max(0, parseFiniteNumber(input.costUsd) ?? 0);

  return {
    userId,
    projectId,
    keyHash,
    model,
    provider,
    promptTokens,
    completionTokens,
    costUsd,
    cacheHit: parseBoolean(input.cacheHit),
    source: coerceSource(input.source, fallbackSource),
    timestamp: coerceTimestamp(input.timestamp)
  };
}

export function normalizeUsageEventsPayload(
  payload: unknown,
  fallbackSource: UsageSource,
  defaults?: UsageDefaults
): UsageEvent[] {
  const rawEvents = (() => {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (isRecord(payload) && Array.isArray(payload.events)) {
      return payload.events;
    }

    return [payload];
  })();

  const events: UsageEvent[] = [];

  for (const raw of rawEvents) {
    const normalized = normalizeUsageEvent(raw, fallbackSource, defaults);
    if (normalized) {
      events.push(normalized);
    }
  }

  return events;
}
