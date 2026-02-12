import type { ErrorEvent } from "@sentry/cloudflare";
import type { TransactionEvent } from "@sentry/core";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-nit-platform-key",
  "x-api-key",
  "x-nit-provider-authorization",
  "x-hub-signature-256",
]);

const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "secret",
  "token",
  "sessionToken",
  "session_token",
  "key",
  "plainKey",
  "apiKey",
  "api_key",
  "slackWebhook",
  "slack_webhook",
  "resendApiKey",
  "resend_api_key",
  "clientSecret",
  "client_secret",
  "githubClientSecret",
  "email",
  "emailRecipients",
  "email_recipients",
  "emailFromAddress",
  "email_from_address",
  "callbackURL",
]);

const SECRET_PATTERNS = [
  /nit_platform_[a-f0-9]+/gi,
  /nit_vk_[a-f0-9]+/gi,
  /Bearer\s+[^\s]+/gi,
  /[a-f0-9]{64}/gi,
  /ghp_[A-Za-z0-9_]+/gi,
  /gho_[A-Za-z0-9_]+/gi,
  /re_[A-Za-z0-9_]+/gi,
  /https:\/\/hooks\.slack\.com\/[^\s"]+/gi,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
];

function redactString(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function scrubObject(obj: unknown, depth = 0): unknown {
  if (depth > 10) return "[MAX_DEPTH]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redactString(obj);
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubObject(item, depth + 1));
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_BODY_KEYS.has(key)) {
      cleaned[key] = "[REDACTED]";
    } else {
      cleaned[key] = scrubObject(value, depth + 1);
    }
  }
  return cleaned;
}

function scrubHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return headers;
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
      cleaned[key] = "[REDACTED]";
    } else {
      cleaned[key] = redactString(value);
    }
  }
  return cleaned;
}

export function beforeSend(
  event: ErrorEvent
): ErrorEvent | null {
  // Scrub request data
  if (event.request) {
    event.request.headers = scrubHeaders(event.request.headers);
    event.request.cookies = undefined;
    if (typeof event.request.data === "string") {
      event.request.data = redactString(event.request.data);
    } else if (event.request.data) {
      event.request.data = scrubObject(event.request.data);
    }
    if (event.request.query_string) {
      event.request.query_string = redactString(
        typeof event.request.query_string === "string"
          ? event.request.query_string
          : ""
      );
    }
  }

  // Keep only opaque userId
  if (event.user) {
    event.user = { id: event.user.id };
  }

  // Scrub breadcrumbs
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => ({
      ...breadcrumb,
      message: breadcrumb.message
        ? redactString(breadcrumb.message)
        : undefined,
      data: breadcrumb.data
        ? (scrubObject(breadcrumb.data) as Record<string, unknown>)
        : undefined,
    }));
  }

  // Scrub exception values (stack trace messages may contain PII)
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) {
        ex.value = redactString(ex.value);
      }
    }
  }

  // Scrub extra/contexts
  if (event.extra) {
    event.extra = scrubObject(event.extra) as Record<string, unknown>;
  }
  if (event.contexts) {
    event.contexts = scrubObject(event.contexts) as typeof event.contexts;
  }

  return event;
}

export function beforeSendTransaction(
  event: TransactionEvent
): TransactionEvent | null {
  if (event.request) {
    event.request.headers = scrubHeaders(event.request.headers);
    event.request.cookies = undefined;
  }
  if (event.user) {
    event.user = { id: event.user.id };
  }
  return event;
}
