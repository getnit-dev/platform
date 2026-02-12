import { Hono, type Context } from "hono";
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

function safeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);

  if (aBytes.length !== bBytes.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    result |= aBytes[i] ^ bBytes[i];
  }

  return result === 0;
}

async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(hashBuffer);

  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

  for (const event of events) {
    await c.env.USAGE_EVENTS_QUEUE.send(event);
  }

  return c.json({ enqueued: events.length });
});
