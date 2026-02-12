export interface UsageEvent {
  userId: string;
  projectId: string | null;
  keyHash: string | null;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  cacheHit: boolean;
  source: "byok" | "cli";
  timestamp: string;
}

export interface AuthSession {
  userId: string;
  sessionToken: string;
  email?: string | null;
  name?: string | null;
  projectId?: string | null;
}

export type AppBindings = {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  AI: unknown;
  ASSETS: Fetcher;
  USAGE_EVENTS_QUEUE: Queue<UsageEvent>;
  USAGE_INGEST_TOKEN?: string;
  USAGE_EVENTS_RETENTION_DAYS?: string;
  USAGE_DAILY_RETENTION_DAYS?: string;
  DRIFT_RETENTION_DAYS?: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  SENTRY_DSN?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  SENTRY_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
};

export type AppVariables = {
  auth: AuthSession;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};
