import { Hono, type Context } from "hono";
import { safeEqual, sha256Hex } from "../lib/crypto";
import { normalizeUsageEventsPayload } from "../lib/usage-events";
import type { AppEnv } from "../types";

interface AuthContext {
  mode: "ingest-token" | "api-key";
  userId?: string;
  projectId?: string | null;
  keyHash?: string;
}

function getPlatformIngestToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return token;
    }
  }

  const headerToken = request.headers.get("x-nit-platform-token");
  return headerToken?.trim() || null;
}

async function resolveAuthContext(
  c: Context<AppEnv>,
  providedToken: string | null
): Promise<AuthContext | null> {
  if (!providedToken) {
    return null;
  }

  const configuredToken = c.env.USAGE_INGEST_TOKEN;
  if (configuredToken && safeEqual(providedToken, configuredToken)) {
    return { mode: "ingest-token" };
  }

  // Check platform_api_keys table
  const keyHash = await sha256Hex(providedToken);
  const row = await c.env.DB.prepare(
    `SELECT key_hash AS keyHash, user_id AS userId, project_id AS projectId
     FROM platform_api_keys
     WHERE key_hash = ? AND revoked = 0
       AND (expires_at IS NULL OR expires_at > datetime('now'))
     LIMIT 1`
  )
    .bind(keyHash)
    .first<{ keyHash: string; userId: string; projectId: string | null }>();

  if (!row || !row.userId) {
    return null;
  }

  return {
    mode: "api-key",
    userId: row.userId,
    projectId: row.projectId,
    keyHash: row.keyHash
  };
}

export const usageIngestRoutes = new Hono<AppEnv>();

usageIngestRoutes.post("/", async (c) => {
  const providedToken = getPlatformIngestToken(c.req.raw);
  const authContext = await resolveAuthContext(c, providedToken);

  if (!authContext) {
    return c.json({ error: "Invalid platform ingest token" }, 401);
  }

  const payload = await c.req.json<unknown>();
  const events = normalizeUsageEventsPayload(payload, "byok", {
    userId: authContext.userId,
    projectId: authContext.projectId,
    keyHash: authContext.keyHash
  });

  if (events.length === 0) {
    return c.json({ error: "No valid usage events in payload" }, 400);
  }

  await c.env.USAGE_EVENTS_QUEUE.sendBatch(
    events.map((event) => ({ body: event }))
  );

  return c.json({ enqueued: events.length });
});
