import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppBindings } from "../types";

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

function getSocialProviders(env: AppBindings) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return undefined;
  }

  return {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET
    }
  };
}

let cachedAuth: ReturnType<typeof betterAuth> | null = null;
let cachedSecret: string | null = null;
let cachedDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function createAuth(env: AppBindings) {
  // If secret changed, invalidate cache
  const currentSecret = env.BETTER_AUTH_SECRET;
  if (!currentSecret) {
    throw new Error("BETTER_AUTH_SECRET is not configured. Set it via: wrangler secret put BETTER_AUTH_SECRET");
  }
  if (cachedSecret !== currentSecret) {
    cachedAuth = null;
    cachedSecret = currentSecret;
  }

  if (!cachedAuth) {
    if (!cachedDb) {
      cachedDb = drizzle(env.DB, {
        schema,
        logger: false
      });
    }

    const socialProviders = getSocialProviders(env);
    const kvStorage = env.KV as unknown as Parameters<typeof withCloudflare>[0]["kv"];
    const d1Db = cachedDb as unknown as NonNullable<Parameters<typeof withCloudflare>[0]["d1"]>["db"];

    cachedAuth = betterAuth(
      withCloudflare(
        {
          autoDetectIpAddress: false,
          geolocationTracking: false,
          d1: {
            db: d1Db,
            options: {
              usePlural: true
            }
          },
          // better-auth-cloudflare can carry a different @cloudflare/workers-types version.
          kv: kvStorage
        },
        {
          secret: currentSecret,
          baseURL: env.BETTER_AUTH_URL,
          trustedOrigins: [
            "http://localhost:5173",
            "http://localhost:8788",
            "https://platform.getnit.dev"
          ],
          emailAndPassword: {
            enabled: true
          },
          socialProviders,
          session: {
            expiresIn: SESSION_EXPIRES_IN_SECONDS,
            updateAge: SESSION_UPDATE_AGE_SECONDS
          },
          advanced: {
            useSecureCookies: !env.BETTER_AUTH_URL?.startsWith("http://localhost")
          }
        }
      )
    );
  }

  return cachedAuth;
}

export function handleAuthRequest(request: Request, env: AppBindings): Promise<Response> {
  const auth = createAuth(env);
  return auth.handler(request);
}
