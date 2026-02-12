import type { MiddlewareHandler } from "hono";
import { createAuth } from "../lib/auth";
import type { AppEnv } from "../types";

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers
  });

  if (!session?.session || !session.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("auth", {
    userId: session.user.id,
    sessionToken: String((session.session as { token?: unknown }).token ?? ""),
    email: session.user.email ?? null,
    name: session.user.name ?? null
  });
  await next();
};
