import * as Sentry from "@sentry/cloudflare";
import { Hono, type Context } from "hono";
import { apiKeyMiddleware } from "../middleware/api-key";
import type { AppEnv, UsageEvent } from "../types";

interface UsageSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

const COST_HEADER_CANDIDATES = [
  "cf-aig-cost",
  "cf-aig-usage-cost",
  "x-ai-gateway-cost",
  "x-aig-cost",
  "x-usage-cost"
];

const CACHE_HIT_HEADERS = ["cf-aig-cache-status", "x-cache-status", "cf-cache-status"];
const MAX_METADATA_FIELDS = 5;

function parseFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric;
}

function getEstimatedTokens(request: Request): number {
  const promptTokens = parseFiniteNumber(request.headers.get("x-nit-estimated-prompt-tokens")) ?? 0;
  const completionTokens =
    parseFiniteNumber(request.headers.get("x-nit-estimated-completion-tokens")) ?? 0;

  return Math.max(promptTokens, 0) + Math.max(completionTokens, 0);
}

function asNonEmptyString(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCostFromHeaders(headers: Headers): number | null {
  for (const headerName of COST_HEADER_CANDIDATES) {
    const rawValue = headers.get(headerName);
    const cost = parseFiniteNumber(rawValue);

    if (cost !== null && cost >= 0) {
      return cost;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractUsageFromPayload(payload: unknown): UsageSnapshot {
  const snapshot: UsageSnapshot = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: null
  };

  if (!isRecord(payload)) {
    return snapshot;
  }

  const usage = isRecord(payload.usage) ? payload.usage : null;
  if (!usage) {
    return snapshot;
  }

  const promptTokens =
    parseFiniteNumber(usage.prompt_tokens) ?? parseFiniteNumber(usage.input_tokens) ?? 0;
  const completionTokens =
    parseFiniteNumber(usage.completion_tokens) ?? parseFiniteNumber(usage.output_tokens) ?? 0;
  const totalTokens =
    parseFiniteNumber(usage.total_tokens) ?? Math.max(promptTokens, 0) + Math.max(completionTokens, 0);

  snapshot.promptTokens = Math.max(promptTokens, 0);
  snapshot.completionTokens = Math.max(completionTokens, 0);
  snapshot.totalTokens = Math.max(totalTokens, 0);
  snapshot.costUsd =
    parseFiniteNumber(usage.cost) ?? parseFiniteNumber(usage.cost_usd) ?? parseFiniteNumber(payload.cost);

  return snapshot;
}

function inferProvider(model: string | null, path: string): string {
  if (model && model.includes("/")) {
    const [provider] = model.split("/");
    if (provider) {
      return provider.toLowerCase();
    }
  }

  const providerMatch = path.match(/^\/(openai|anthropic|bedrock|google|meta|mistral|deepseek)(?:\/|$)/i);
  if (providerMatch?.[1]) {
    return providerMatch[1].toLowerCase();
  }

  return "openai";
}

function convertToOpenRouterModel(model: string | null, provider: string): string {
  if (!model) {
    return "openai/gpt-4";
  }

  // Already in OpenRouter format
  if (model.includes("/")) {
    return model;
  }

  // Convert common model names to OpenRouter format
  const modelLower = model.toLowerCase();

  // OpenAI models
  if (modelLower.startsWith("gpt-") || modelLower.startsWith("o1-") || modelLower.startsWith("o3-")) {
    return `openai/${model}`;
  }

  // Anthropic models
  if (modelLower.includes("claude")) {
    return `anthropic/${model}`;
  }

  // Google models
  if (modelLower.includes("gemini") || modelLower.includes("palm")) {
    return `google/${model}`;
  }

  // Meta models
  if (modelLower.includes("llama")) {
    return `meta-llama/${model}`;
  }

  // Mistral models
  if (modelLower.includes("mistral") || modelLower.includes("mixtral")) {
    return `mistralai/${model}`;
  }

  // DeepSeek models
  if (modelLower.includes("deepseek")) {
    return `deepseek/${model}`;
  }

  // Fallback: use the inferred provider
  return `${provider}/${model}`;
}

function getGatewayPath(requestPath: string): string {
  const prefix = "/api/v1/llm-proxy";
  const subPath = requestPath.startsWith(prefix) ? requestPath.slice(prefix.length) : requestPath;

  if (!subPath || subPath === "/") {
    return "/compat/chat/completions";
  }

  if (subPath.startsWith("/chat/completions")) {
    return "/compat/chat/completions";
  }

  if (subPath.startsWith("/embeddings")) {
    return "/compat/embeddings";
  }

  if (subPath.startsWith("/responses")) {
    return "/compat/responses";
  }

  return subPath;
}

function getCacheHit(headers: Headers): boolean {
  for (const headerName of CACHE_HIT_HEADERS) {
    const rawValue = headers.get(headerName);
    if (rawValue?.toUpperCase().includes("HIT")) {
      return true;
    }
  }

  return false;
}

async function resolveMarginMultiplier(c: AppEnv["Bindings"], provider: string): Promise<number> {
  const kvValue = await c.KV.get(`margin:provider:${provider}`);
  const kvMultiplier = parseFiniteNumber(kvValue);
  if (kvMultiplier !== null && kvMultiplier >= 1) {
    return kvMultiplier;
  }

  try {
    const row = await c.DB.prepare(
      "SELECT multiplier FROM provider_margins WHERE provider = ? LIMIT 1"
    )
      .bind(provider)
      .first<{ multiplier?: number | string | null }>();

    const dbMultiplier = parseFiniteNumber(row?.multiplier ?? null);
    if (dbMultiplier !== null && dbMultiplier >= 1) {
      return dbMultiplier;
    }
  } catch {
    // provider_margins table is optional for now.
  }

  const defaultMultiplier = parseFiniteNumber(c.DEFAULT_MARGIN_MULTIPLIER) ?? 1.15;
  if (defaultMultiplier < 1) {
    return 1;
  }

  return defaultMultiplier;
}

async function incrementSpendTotal(
  c: AppEnv["Bindings"],
  keyHash: string,
  deltaUsd: number
): Promise<boolean> {
  if (deltaUsd <= 0) {
    return true;
  }

  const result = await c.DB.prepare(
    `
    UPDATE virtual_keys
    SET spend_total = spend_total + ?
    WHERE key_hash = ?
      AND revoked = 0
      AND (max_budget IS NULL OR spend_total + ? <= max_budget)
  `
  )
    .bind(deltaUsd, keyHash, deltaUsd)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

function buildGatewayHeaders(
  originalHeaders: Headers,
  options: {
    metadata: Record<string, string | number | boolean>;
    byokAlias: string | null;
    providerAuthorization: string | null;
    gatewayToken: string | null;
    maxAttempts: string | null;
    retryDelayMs: string | null;
    retryBackoff: string | null;
    requestTimeoutMs: string | null;
  }
): Headers {
  const proxiedHeaders = new Headers();

  originalHeaders.forEach((value, key) => {
    const lower = key.toLowerCase();

    if (
      lower === "authorization" ||
      lower === "host" ||
      lower === "content-length" ||
      lower === "x-api-key" ||
      lower === "x-nit-platform-key" ||
      lower === "x-nit-provider-authorization" ||
      lower === "x-nit-byok-alias" ||
      lower === "x-nit-estimated-prompt-tokens" ||
      lower === "x-nit-estimated-completion-tokens"
    ) {
      return;
    }

    proxiedHeaders.set(key, value);
  });

  proxiedHeaders.set("cf-aig-metadata", JSON.stringify(options.metadata));

  if (options.byokAlias) {
    proxiedHeaders.set("cf-aig-byok-alias", options.byokAlias);
  }

  if (options.providerAuthorization) {
    proxiedHeaders.set("authorization", options.providerAuthorization);
  }

  if (options.gatewayToken) {
    proxiedHeaders.set("cf-aig-authorization", `Bearer ${options.gatewayToken}`);
  }

  if (options.maxAttempts) {
    proxiedHeaders.set("cf-aig-max-attempts", options.maxAttempts);
  }

  if (options.retryDelayMs) {
    proxiedHeaders.set("cf-aig-retry-delay", options.retryDelayMs);
  }

  if (options.retryBackoff) {
    proxiedHeaders.set("cf-aig-retry-backoff", options.retryBackoff);
  }

  if (options.requestTimeoutMs) {
    proxiedHeaders.set("cf-aig-request-timeout", options.requestTimeoutMs);
  }

  return proxiedHeaders;
}

function coerceUsageEvent(event: UsageEvent): UsageEvent {
  return {
    ...event,
    promptTokens: Math.max(0, Math.floor(event.promptTokens)),
    completionTokens: Math.max(0, Math.floor(event.completionTokens)),
    costUsd: Math.max(0, event.costUsd),
    marginUsd: Math.max(0, event.marginUsd)
  };
}

async function handleLlmProxy(c: Context<AppEnv>) {
  const apiKey = c.get("apiKey");

  const method = c.req.raw.method.toUpperCase();
  const requestPath = c.req.path;
  const gatewayPath = getGatewayPath(requestPath);

  let requestBodyText = method === "GET" || method === "HEAD" ? null : await c.req.text();
  let requestPayload: unknown = null;

  if (requestBodyText && requestBodyText.trim().length > 0) {
    try {
      requestPayload = JSON.parse(requestBodyText);
    } catch {
      requestPayload = null;
    }
  }

  const requestModel =
    isRecord(requestPayload) && typeof requestPayload.model === "string" ? requestPayload.model : null;
  const provider = inferProvider(requestModel, gatewayPath);

  // Convert model to OpenRouter format
  const openRouterModel = convertToOpenRouterModel(requestModel, provider);

  // Update the request payload with OpenRouter model name
  if (isRecord(requestPayload) && requestPayload.model) {
    requestPayload = { ...requestPayload, model: openRouterModel };
    requestBodyText = JSON.stringify(requestPayload);
  }

  // Always use "default" BYOK alias for OpenRouter
  const byokAliasOverride = asNonEmptyString(c.req.header("x-nit-byok-alias"));
  const byokAlias = byokAliasOverride ?? "default";

  const metadataEntries = [
    ["nit_user_id", apiKey.userId],
    ["nit_project_id", apiKey.projectId ?? ""],
    ["nit_key_hash", apiKey.keyHash],
    ["nit_provider", provider],
    ["nit_model", requestModel ?? "unknown"]
  ].filter(([, value]) => typeof value === "string" && value.trim().length > 0);

  const metadata = Object.fromEntries(metadataEntries.slice(0, MAX_METADATA_FIELDS));
  const providerAuthorization = asNonEmptyString(c.req.header("x-nit-provider-authorization"));

  const targetUrl = new URL(`${c.env.AI_GATEWAY_BASE_URL}${gatewayPath}`);
  if (c.req.raw.url.includes("?")) {
    targetUrl.search = new URL(c.req.raw.url).search;
  }

  const gatewayHeaders = buildGatewayHeaders(c.req.raw.headers, {
    metadata,
    byokAlias,
    providerAuthorization,
    gatewayToken: c.env.AI_GATEWAY_TOKEN ?? null,
    maxAttempts: c.env.AI_GATEWAY_MAX_ATTEMPTS ?? null,
    retryDelayMs: c.env.AI_GATEWAY_RETRY_DELAY_MS ?? null,
    retryBackoff: c.env.AI_GATEWAY_RETRY_BACKOFF ?? null,
    requestTimeoutMs: c.env.AI_GATEWAY_REQUEST_TIMEOUT_MS ?? null
  });

  const gatewayResponse = await fetch(targetUrl.toString(), {
    method,
    headers: gatewayHeaders,
    body: requestBodyText
  });

  const responseHeaders = new Headers(gatewayResponse.headers);
  const responseCostFromHeaders = parseCostFromHeaders(gatewayResponse.headers);
  const cacheHit = getCacheHit(gatewayResponse.headers);

  let responseText: string | null = null;
  let responsePayload: unknown = null;

  const isStreamingRequested = isRecord(requestPayload) && requestPayload.stream === true;

  if (!isStreamingRequested) {
    responseText = await gatewayResponse.text();

    try {
      responsePayload = JSON.parse(responseText);
    } catch {
      responsePayload = null;
    }
  }

  const usage = extractUsageFromPayload(responsePayload);
  const estimatedTokens = getEstimatedTokens(c.req.raw);

  const promptTokens = usage.promptTokens;
  const completionTokens = usage.completionTokens;
  const totalTokens = usage.totalTokens > 0 ? usage.totalTokens : estimatedTokens;

  const providerCostUsd =
    responseCostFromHeaders ?? usage.costUsd ?? parseFiniteNumber(responseHeaders.get("x-nit-cost-usd")) ?? 0;

  const marginMultiplier = await resolveMarginMultiplier(c.env, provider);
  const marginUsd = providerCostUsd * Math.max(marginMultiplier - 1, 0);
  const chargedCostUsd = providerCostUsd + marginUsd;

  const spendUpdated = await incrementSpendTotal(c.env, apiKey.keyHash, chargedCostUsd);

  Sentry.metrics.count("llm.proxy.requests", 1, {
    attributes: { provider, cache_hit: cacheHit ? "true" : "false" },
  });
  Sentry.metrics.distribution("llm.proxy.cost_usd", providerCostUsd, {
    attributes: { provider, model: requestModel ?? "unknown" },
    unit: "none",
  });
  Sentry.metrics.distribution("llm.proxy.total_tokens", totalTokens, {
    attributes: { provider, model: requestModel ?? "unknown" },
  });

  if (!spendUpdated) {
    Sentry.metrics.count("llm.proxy.budget_exceeded", 1, {
      attributes: { provider },
    });
    return c.json(
      {
        error: "Budget exceeded for this key"
      },
      402
    );
  }

  const usageEvent = coerceUsageEvent({
    userId: apiKey.userId,
    projectId: apiKey.projectId,
    keyHash: apiKey.keyHash,
    model: requestModel ?? "unknown",
    provider,
    promptTokens,
    completionTokens: completionTokens > 0 ? completionTokens : Math.max(totalTokens - promptTokens, 0),
    costUsd: providerCostUsd,
    marginUsd,
    cacheHit,
    source: "api",
    timestamp: new Date().toISOString()
  });

  await c.env.USAGE_EVENTS_QUEUE.send(usageEvent);

  responseHeaders.set("x-nit-provider", provider);
  responseHeaders.set("x-nit-cost-usd", providerCostUsd.toFixed(8));
  responseHeaders.set("x-nit-margin-usd", marginUsd.toFixed(8));
  responseHeaders.set("x-nit-charge-usd", chargedCostUsd.toFixed(8));
  responseHeaders.set("x-nit-cache-hit", cacheHit ? "1" : "0");
  responseHeaders.delete("content-length");

  if (responseText !== null) {
    return new Response(responseText, {
      status: gatewayResponse.status,
      statusText: gatewayResponse.statusText,
      headers: responseHeaders
    });
  }

  return new Response(gatewayResponse.body, {
    status: gatewayResponse.status,
    statusText: gatewayResponse.statusText,
    headers: responseHeaders
  });
}

export const llmProxyRoutes = new Hono<AppEnv>();

llmProxyRoutes.use("/*", apiKeyMiddleware);
llmProxyRoutes.all("/", handleLlmProxy);
llmProxyRoutes.all("/*", handleLlmProxy);
