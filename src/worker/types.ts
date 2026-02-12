export interface UsageEvent {
  userId: string;
  projectId: string | null;
  keyHash: string | null;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  marginUsd: number;
  cacheHit: boolean;
  source: "api" | "platform" | "byok" | "cli";
  timestamp: string;
}

export interface AuthSession {
  userId: string;
  sessionToken: string;
  email?: string | null;
  name?: string | null;
}

export interface VirtualKeyContext {
  keyHash: string;
  userId: string;
  projectId: string | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  maxBudget: number | null;
  spendTotal: number;
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
  AI_GATEWAY_BASE_URL: string;
  AI_GATEWAY_TOKEN?: string;
  AI_GATEWAY_BYOK_ALIAS_MAP?: string;
  AI_GATEWAY_MAX_ATTEMPTS?: string;
  AI_GATEWAY_RETRY_DELAY_MS?: string;
  AI_GATEWAY_RETRY_BACKOFF?: string;
  AI_GATEWAY_REQUEST_TIMEOUT_MS?: string;
  DEFAULT_MARGIN_MULTIPLIER?: string;
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
  apiKey: VirtualKeyContext;
};

export type AppEnv = {
  Bindings: AppBindings;
  Variables: AppVariables;
};
