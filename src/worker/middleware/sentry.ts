import * as Sentry from "@sentry/cloudflare";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

export const sentryMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const vars = c.var as Partial<AppEnv["Variables"]>;
  const userId = vars.auth?.userId ?? vars.apiKey?.userId;

  if (userId) {
    Sentry.setUser({ id: userId });
  }

  Sentry.setTag("route", c.req.routePath ?? c.req.path);
  Sentry.setTag("method", c.req.method);

  if (vars.apiKey) {
    Sentry.setTag("auth_mode", "api-key");
  } else if (vars.auth) {
    Sentry.setTag("auth_mode", "session");
  }

  try {
    await next();
  } catch (error) {
    Sentry.captureException(error);
    throw error;
  }

  if (c.res.status >= 500) {
    Sentry.captureMessage(
      `HTTP ${c.res.status} on ${c.req.method} ${c.req.routePath}`,
      "error"
    );
  }
};
