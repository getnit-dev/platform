import { Sentry } from "./sentry";

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function getBaseUrl(): string {
  const raw = import.meta.env.VITE_PLATFORM_API_BASE_URL?.trim();
  if (!raw) {
    return "";
  }

  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

const API_BASE_URL = getBaseUrl();

function buildUrl(path: string, query?: Record<string, string | number | boolean | null | undefined>): string {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return API_BASE_URL ? url.toString() : `${url.pathname}${url.search}`;
}

async function parseErrorPayload(response: Response): Promise<{ message: string; details: unknown }> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const json = await response.json() as Record<string, unknown>;

      // Extract message from various possible structures
      const message =
        (typeof json.error === "string" && json.error) ||
        (typeof json.message === "string" && json.message) ||
        (typeof json.error === "object" && json.error && typeof (json.error as Record<string, unknown>).message === "string" && (json.error as Record<string, unknown>).message as string) ||
        `${response.status} ${response.statusText}`;

      return { message, details: json };
    } catch {
      // If JSON parsing fails, fall back to text
      const text = await response.text();
      return {
        message: text || `${response.status} ${response.statusText}`,
        details: text
      };
    }
  }

  const text = await response.text();
  return {
    message: text || `${response.status} ${response.statusText}`,
    details: text
  };
}

async function request<TResponse>(
  path: string,
  init?: Omit<RequestInit, "body"> & {
    body?: BodyInit | Record<string, unknown>;
    query?: Record<string, string | number | boolean | null | undefined>;
  }
): Promise<TResponse> {
  const headers = new Headers(init?.headers);
  const body = init?.body;

  let payload: BodyInit | undefined;
  if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof URLSearchParams)) {
    headers.set("content-type", "application/json");
    payload = JSON.stringify(body);
  } else {
    payload = body as BodyInit | undefined;
  }

  const response = await fetch(buildUrl(path, init?.query), {
    method: init?.method ?? "GET",
    headers,
    credentials: "include",
    body: payload
  });

  if (!response.ok) {
    const error = await parseErrorPayload(response);

    Sentry.addBreadcrumb({
      category: "api",
      message: `${init?.method ?? "GET"} ${path} -> ${response.status}`,
      level: response.status >= 500 ? "error" : "warning",
      data: { status: response.status },
    });

    const apiError = new ApiError(error.message, response.status, error.details);

    if (response.status >= 500) {
      Sentry.captureException(apiError);
    }

    throw apiError;
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json() as TResponse;
  }

  return await response.text() as TResponse;
}

export interface DashboardUser {
  userId: string;
  email: string;
  name: string | null;
}

export interface Project {
  id: string;
  userId?: string;
  name: string;
  repoUrl: string | null;
  repoProvider: string;
  defaultBranch: string;
  createdAt?: string;
  updatedAt?: string;
  totalRuns?: number;
  detectedBugs?: number;
  createdIssues?: number;
  createdPRs?: number;
  totalCommits?: number;
  totalTokens?: number;
}

export interface CoverageReport {
  id: string;
  projectId: string;
  packageId: string | null;
  runId: string;
  runMode: string;
  branch: string | null;
  commitSha: string | null;
  unitCoverage: number | null;
  integrationCoverage: number | null;
  e2eCoverage: number | null;
  overallCoverage: number | null;
  testsGenerated: number;
  testsPassed: number;
  testsFailed: number;
  bugsFound: number;
  bugsFixed: number;
  reportR2Key: string | null;
  llmProvider: string | null;
  llmModel: string | null;
  llmPromptTokens: number | null;
  llmCompletionTokens: number | null;
  llmTotalTokens: number | null;
  llmCostUsd: number | null;
  executionTimeMs: number | null;
  executionEnvironment: string | null;
  runMetadata: string | null;
  createdAt: string;
}

export interface DriftResult {
  id: string;
  projectId: string;
  testName: string;
  status: string;
  similarityScore: number | null;
  baselineOutput: string | null;
  currentOutput: string | null;
  details: string | null;
  createdAt: string;
}

export interface DriftTimelinePoint {
  date: string;
  total: number;
  drifted: number;
  avgSimilarity: number | null;
}

export interface Bug {
  id: string;
  projectId: string;
  packageId: string | null;
  filePath: string;
  functionName: string | null;
  description: string;
  rootCause: string | null;
  severity: string;
  status: string;
  githubIssueUrl: string | null;
  githubPrUrl: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PlatformApiKey {
  id: string;
  keyHash: string;
  keyHashPrefix: string;
  projectId: string | null;
  name: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
}

export interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface UsageDailyPoint {
  date: string;
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
}

export interface UsageBreakdownRow {
  provider: string;
  model: string;
  requests: number;
  tokens: number;
  totalCostUsd: number;
  avgDurationMs: number | null;
}

export interface UsageLatencyPoint {
  date: string;
  avgDurationMs: number;
  requestCount: number;
}

export interface UploadResult {
  key: string;
  projectId: string;
  size: number;
  contentType: string;
}

export interface MemoryApiResponse {
  version: number;
  global: {
    conventions: Record<string, unknown>;
    knownPatterns: Array<{
      pattern: string;
      success_count: number;
      last_used: string;
      context: Record<string, unknown>;
    }>;
    failedPatterns: Array<{
      pattern: string;
      reason: string;
      timestamp: string;
      context: Record<string, unknown>;
    }>;
    generationStats: Record<string, unknown>;
  } | null;
  packages: Record<string, {
    testPatterns: Record<string, unknown>;
    knownIssues: Array<unknown>;
    coverageHistory: Array<unknown>;
    llmFeedback: Array<unknown>;
  }>;
}

export const api = {
  auth: {
    register: (input: { name: string; email: string; password: string; callbackURL?: string }) =>
      request<{ token: string | null; user: { id: string; name: string; email: string } }>("/api/auth/sign-up/email", {
        method: "POST",
        body: input
      }),

    login: (input: { email: string; password: string; callbackURL?: string }) =>
      request<{ token: string; user: { id: string; name: string; email: string } }>("/api/auth/sign-in/email", {
        method: "POST",
        body: input
      }),

    loginWithGithub: (input: { callbackURL: string }) =>
      request<{ url?: string; redirect?: boolean }>("/api/auth/sign-in/social", {
        method: "POST",
        body: {
          provider: "github",
          disableRedirect: true,
          callbackURL: input.callbackURL
        }
      }),

    logout: () =>
      request<{ success?: boolean }>("/api/auth/sign-out", {
        method: "POST",
        body: {}
      })
  },

  dashboard: {
    me: () => request<DashboardUser>("/api/dashboard/me")
  },

  projects: {
    list: () => request<{ projects: Project[] }>("/api/projects"),
    get: (projectId: string) => request<{ project: Project }>(`/api/projects/${projectId}`),
    create: (input: { name: string; repoUrl?: string | null; repoProvider?: string; defaultBranch?: string }) =>
      request<{ project: Project }>("/api/projects", {
        method: "POST",
        body: input
      }),
    update: (projectId: string, input: Partial<Pick<Project, "name" | "repoUrl" | "repoProvider" | "defaultBranch">>) =>
      request<{ updated: boolean }>(`/api/projects/${projectId}`, {
        method: "PATCH",
        body: input
      }),
    remove: (projectId: string) =>
      request<{ deleted: boolean }>(`/api/projects/${projectId}`, {
        method: "DELETE"
      })
  },

  reports: {
    list: (query?: { projectId?: string; limit?: number }) =>
      request<{ reports: CoverageReport[] }>("/api/v1/reports", {
        query
      }),

    get: (reportId: string, query?: { includeFull?: boolean }) =>
      request<{ report: CoverageReport; fullReport?: unknown }>(`/api/v1/reports/${reportId}`, {
        query: query ? { includeFull: query.includeFull ? 1 : 0 } : undefined
      }),

    upload: (input: Record<string, unknown>) =>
      request<{ reportId: string; reportR2Key: string }>("/api/v1/reports", {
        method: "POST",
        body: input
      })
  },

  drift: {
    list: (query?: { projectId?: string; status?: string; limit?: number }) =>
      request<{ results: DriftResult[] }>("/api/v1/drift", {
        query
      }),

    timeline: (query?: { projectId?: string; days?: number }) =>
      request<{ timeline: DriftTimelinePoint[] }>("/api/v1/drift/timeline", {
        query
      }),

    upload: (input: unknown) =>
      request<{ inserted: number; ids: string[] }>("/api/v1/drift", {
        method: "POST",
        body: input as Record<string, unknown>
      })
  },

  bugs: {
    list: (query?: { projectId?: string; status?: string; severity?: string; limit?: number }) =>
      request<{ bugs: Bug[] }>("/api/v1/bugs", {
        query
      }),

    create: (input: {
      projectId: string;
      filePath: string;
      description: string;
      packageId?: string;
      functionName?: string;
      rootCause?: string;
      severity?: string;
      status?: string;
      githubIssueUrl?: string;
      githubPrUrl?: string;
    }) =>
      request<{ bugId: string }>("/api/v1/bugs", {
        method: "POST",
        body: input
      }),

    update: (bugId: string, input: { status?: string; githubIssueUrl?: string | null; githubPrUrl?: string | null }) =>
      request<{ updated: boolean }>(`/api/v1/bugs/${bugId}`, {
        method: "PATCH",
        body: input
      })
  },

  upload: {
    put: (projectId: string, filename: string, body: BodyInit, contentType = "application/json") =>
      request<UploadResult>("/api/v1/upload", {
        method: "POST",
        query: { projectId, filename },
        headers: {
          "content-type": contentType
        },
        body
      }),

    get: async (key: string): Promise<Response> => {
      const response = await fetch(buildUrl("/api/v1/upload", { key }), {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        const error = await parseErrorPayload(response);
        throw new ApiError(error.message, response.status, error.details);
      }

      return response;
    },

    remove: (key: string) =>
      request<{ deleted: boolean }>("/api/v1/upload", {
        method: "DELETE",
        query: { key }
      })
  },

  webhooks: {
    github: (payload: unknown, signature: string) =>
      request<{ accepted: boolean; event: string; deliveryId: string; storedAs: string }>("/api/webhooks/github", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature
        },
        body: payload as Record<string, unknown>
      })
  },

  llmUsage: {
    summary: (query?: { projectId?: string; days?: number }) =>
      request<{ summary: UsageSummary }>("/api/llm-usage/summary", {
        query
      }),

    daily: (query?: { projectId?: string; days?: number }) =>
      request<{ daily: UsageDailyPoint[] }>("/api/llm-usage/daily", {
        query
      }),

    breakdown: (query?: { projectId?: string; days?: number }) =>
      request<{ breakdown: UsageBreakdownRow[] }>("/api/llm-usage/breakdown", {
        query
      }),

    latency: (query?: { projectId?: string; days?: number }) =>
      request<{ latency: UsageLatencyPoint[] }>("/api/llm-usage/latency", {
        query
      })
  },

  memory: {
    get: (projectId: string) =>
      request<MemoryApiResponse>("/api/v1/memory", {
        query: { projectId }
      })
  },

  health: () => request<{ status: string; service: string }>("/api/health"),

  alertConfig: {
    get: (projectId: string) =>
      request<{
        config: {
          id: string | null;
          projectId: string;
          slackWebhook: string | null;
          slackWebhookConfigured: boolean;
          emailThresholdUsd: number | null;
          budgetAlertPercent: number | null;
          emailRecipients: string | null;
          resendApiKey: string | null;
          resendApiKeyConfigured: boolean;
          emailFromAddress: string | null;
          createdAt: string | null;
          updatedAt: string | null;
        };
      }>(`/api/alert-config/${projectId}`),

    update: (projectId: string, config: {
      slackWebhook?: string | null;
      emailThresholdUsd?: number | null;
      budgetAlertPercent?: number | null;
      emailRecipients?: string | null;
      resendApiKey?: string | null;
      emailFromAddress?: string | null;
    }) =>
      request<{ success: boolean }>(`/api/alert-config/${projectId}`, {
        method: "PUT",
        body: config
      })
  },

  platformKeys: {
    list: (query?: { projectId?: string }) =>
      request<{ keys: PlatformApiKey[] }>("/api/platform-keys", {
        query
      }),

    create: (input: {
      name?: string;
      projectId?: string;
      expiresAt?: string;
    }) =>
      request<{ key: string; keyId: string; keyHash: string; projectId: string | null; name: string | null; expiresAt: string | null }>("/api/platform-keys", {
        method: "POST",
        body: input
      }),

    revoke: (keyId: string) =>
      request<{ revoked: boolean }>(`/api/platform-keys/${keyId}/revoke`, {
        method: "POST"
      }),

    delete: (keyId: string) =>
      request<{ deleted: boolean }>(`/api/platform-keys/${keyId}`, {
        method: "DELETE"
      })
  }
};
