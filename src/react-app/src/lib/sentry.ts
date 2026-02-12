import * as Sentry from "@sentry/react";

const FRONTEND_DSN = import.meta.env.VITE_SENTRY_DSN ?? "";
const ENVIRONMENT = import.meta.env.VITE_SENTRY_ENVIRONMENT ?? "development";

const SECRET_PATTERNS = [
  /nit_platform_[a-f0-9]+/gi,
  /nit_vk_[a-f0-9]+/gi,
  /Bearer\s+[^\s]+/gi,
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

export function initSentry(): void {
  if (!FRONTEND_DSN) {
    return;
  }

  Sentry.init({
    dsn: FRONTEND_DSN,
    environment: ENVIRONMENT,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    sendDefaultPii: false,

    beforeSend(event) {
      if (event.user) {
        event.user = { id: event.user.id };
      }

      if (event.request) {
        event.request.cookies = undefined;
        if (event.request.headers) {
          delete event.request.headers["cookie"];
          delete event.request.headers["authorization"];
        }
      }

      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((bc) => ({
          ...bc,
          message: bc.message ? redactString(bc.message) : undefined,
        }));
      }

      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) {
            ex.value = redactString(ex.value);
          }
        }
      }

      return event;
    },

    beforeSendTransaction(event) {
      if (event.user) {
        event.user = { id: event.user.id };
      }
      return event;
    },
  });
}

export { Sentry };
