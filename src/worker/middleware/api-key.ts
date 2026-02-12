import * as Sentry from "@sentry/cloudflare";
import type { MiddlewareHandler } from "hono";
import type { AppEnv, VirtualKeyContext } from "../types";

interface VirtualKeyRow {
  keyHash: string;
  userId: string;
  projectId?: string | null;
  rpmLimit?: number | string | null;
  tpmLimit?: number | string | null;
  maxBudget?: number | string | null;
  spendTotal?: number | string | null;
  expiresAt?: string | null;
  revoked?: number | boolean | null;
}

function parseNumeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseBoolean(value: number | boolean | null | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  return false;
}

function getPlatformKey(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return token;
    }
  }

  const headerToken =
    request.headers.get("x-nit-platform-key") ?? request.headers.get("x-api-key");

  return headerToken?.trim() || null;
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(hashBuffer);

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) {
    return false;
  }

  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

async function loadVirtualKey(
  db: D1Database,
  rawKey: string,
  keyHash: string
): Promise<VirtualKeyRow | null> {
  // Check if it's a platform key first
  if (rawKey.startsWith("nit_platform_")) {
    const platformSql = `
      SELECT
        key_hash AS keyHash,
        user_id AS userId,
        project_id AS projectId,
        NULL AS rpmLimit,
        NULL AS tpmLimit,
        NULL AS maxBudget,
        NULL AS spendTotal,
        expires_at AS expiresAt,
        revoked AS revoked
      FROM platform_api_keys
      WHERE key_hash = ?
      LIMIT 1
    `;

    try {
      const row = await db.prepare(platformSql).bind(keyHash).first<VirtualKeyRow>();
      if (row) {
        // Update last_used_at
        await db.prepare("UPDATE platform_api_keys SET last_used_at = datetime('now') WHERE key_hash = ?")
          .bind(keyHash)
          .run();
        return row;
      }
    } catch {
      // Schema may be in progress; continue to check virtual_keys
    }
  }

  // Check virtual_keys (LLM proxy keys)
  const sql = `
    SELECT
      key_hash AS keyHash,
      user_id AS userId,
      project_id AS projectId,
      rpm_limit AS rpmLimit,
      tpm_limit AS tpmLimit,
      max_budget AS maxBudget,
      spend_total AS spendTotal,
      expires_at AS expiresAt,
      revoked AS revoked
    FROM virtual_keys
    WHERE key_hash = ? OR key_hash = ?
    LIMIT 1
  `;

  try {
    const row = await db.prepare(sql).bind(keyHash, rawKey).first<VirtualKeyRow>();
    return row ?? null;
  } catch {
    // Schema may be in progress; fail closed as unauthorized.
    return null;
  }
}

async function incrementWithinLimit(
  kv: KVNamespace,
  key: string,
  incrementBy: number,
  limit: number,
  ttlSeconds: number
): Promise<boolean> {
  const currentRaw = await kv.get(key);
  const current = currentRaw ? Number(currentRaw) : 0;

  if (!Number.isFinite(current)) {
    return false;
  }

  const next = current + incrementBy;
  if (next > limit) {
    return false;
  }

  await kv.put(key, String(next), { expirationTtl: ttlSeconds });
  return true;
}

function getEstimatedTokens(request: Request): number {
  const promptTokens = Number(request.headers.get("x-nit-estimated-prompt-tokens") ?? "0");
  const completionTokens = Number(
    request.headers.get("x-nit-estimated-completion-tokens") ?? "0"
  );

  const total =
    (Number.isFinite(promptTokens) ? Math.max(promptTokens, 0) : 0) +
    (Number.isFinite(completionTokens) ? Math.max(completionTokens, 0) : 0);

  return total;
}

export const apiKeyMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const platformKey = getPlatformKey(c.req.raw);
  if (!platformKey) {
    return c.json({ error: "Missing platform API key" }, 401);
  }

  const keyHash = await sha256Hex(platformKey);
  const record = await loadVirtualKey(c.env.DB, platformKey, keyHash);

  if (!record || !record.userId || !record.keyHash) {
    return c.json({ error: "Invalid platform API key" }, 401);
  }

  if (parseBoolean(record.revoked)) {
    return c.json({ error: "Platform API key revoked" }, 401);
  }

  if (isExpired(record.expiresAt)) {
    return c.json({ error: "Platform API key expired" }, 401);
  }

  const maxBudget = parseNumeric(record.maxBudget);
  const spendTotal = parseNumeric(record.spendTotal) ?? 0;
  if (maxBudget !== null && spendTotal >= maxBudget) {
    return c.json({ error: "Budget exceeded for this key" }, 402);
  }

  const nowWindow = Math.floor(Date.now() / 60_000);
  const rpmLimit = parseNumeric(record.rpmLimit);
  if (rpmLimit !== null) {
    const rpmKey = `rate_limit:${record.keyHash}:rpm:${nowWindow}`;
    const accepted = await incrementWithinLimit(c.env.KV, rpmKey, 1, rpmLimit, 75);

    if (!accepted) {
      Sentry.metrics.count("rate_limit.exceeded", 1, {
        attributes: { limit_type: "rpm" },
      });
      return c.json({ error: "Requests per minute limit exceeded" }, 429);
    }
  }

  const tpmLimit = parseNumeric(record.tpmLimit);
  const estimatedTokens = getEstimatedTokens(c.req.raw);
  if (tpmLimit !== null && estimatedTokens > 0) {
    const tpmKey = `rate_limit:${record.keyHash}:tpm:${nowWindow}`;
    const accepted = await incrementWithinLimit(
      c.env.KV,
      tpmKey,
      estimatedTokens,
      tpmLimit,
      75
    );

    if (!accepted) {
      Sentry.metrics.count("rate_limit.exceeded", 1, {
        attributes: { limit_type: "tpm" },
      });
      return c.json({ error: "Tokens per minute limit exceeded" }, 429);
    }
  }

  const virtualKeyContext: VirtualKeyContext = {
    keyHash: record.keyHash,
    userId: record.userId,
    projectId: record.projectId ?? null,
    rpmLimit,
    tpmLimit,
    maxBudget,
    spendTotal
  };

  c.set("apiKey", virtualKeyContext);
  await next();
};
