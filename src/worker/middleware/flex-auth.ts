import type { MiddlewareHandler } from "hono";
import { authMiddleware } from "./auth";
import { logger } from "../lib/logger";
import type { AppEnv } from "../types";

/**
 * Combined auth middleware that accepts either a platform API key or a session cookie.
 *
 * If the request carries an API key indicator (Authorization Bearer header,
 * x-nit-platform-key, or x-api-key), it validates the key against the
 * platform_api_keys table. Otherwise it falls back to session-based auth.
 */
export const flexAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.raw.headers.get("authorization");
  const platformKeyHeader = c.req.raw.headers.get("x-nit-platform-key");
  const apiKeyHeader = c.req.raw.headers.get("x-api-key");

  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const apiKey = platformKeyHeader || apiKeyHeader || bearerToken;

  if (apiKey) {
    // Validate against platform_api_keys table
    const db = c.env.DB;
    const keyHash = await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(apiKey))
      .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""));

    const row = await db
      .prepare("SELECT user_id, project_id FROM platform_api_keys WHERE key_hash = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))")
      .bind(keyHash)
      .first<{ user_id: string; project_id: string | null }>();

    if (!row) {
      return c.json({ error: "Invalid or revoked API key" }, 401);
    }

    // Update last_used_at (fire-and-forget)
    db.prepare("UPDATE platform_api_keys SET last_used_at = datetime('now') WHERE key_hash = ?")
      .bind(keyHash)
      .run()
      .catch((err) => {
        logger.warn("last_used_at_update_failed", {
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });

    c.set("auth", {
      userId: row.user_id,
      sessionToken: "",
      email: null,
      name: null,
      projectId: row.project_id,
    });

    return next();
  }

  return authMiddleware(c, next);
};
