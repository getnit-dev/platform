import type { MiddlewareHandler } from "hono";
import { apiKeyMiddleware } from "./api-key";
import { authMiddleware } from "./auth";
import type { AppEnv } from "../types";

/**
 * Combined auth middleware that accepts either an API key or a session cookie.
 *
 * If the request carries an API key indicator (Authorization Bearer header,
 * x-nit-platform-key, or x-api-key), it delegates to the full API key
 * middleware (which validates the key, checks rate limits, budgets, etc.).
 *
 * Otherwise it falls back to session-based auth via cookies.
 */
export const flexAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const hasApiKey = !!(
    c.req.raw.headers.get("x-nit-platform-key") ||
    c.req.raw.headers.get("x-api-key") ||
    c.req.raw.headers.get("authorization")?.startsWith("Bearer ")
  );

  if (hasApiKey) {
    return apiKeyMiddleware(c, next);
  }

  return authMiddleware(c, next);
};
