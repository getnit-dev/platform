import { withSentry } from "@sentry/cloudflare";
import { beforeSend, beforeSendTransaction } from "./sentry-privacy";
import type { AppBindings } from "../types";

export function wrapWithSentry(
  handler: ExportedHandler<AppBindings>
): ExportedHandler<AppBindings> {
  return withSentry(
    (env: AppBindings) => ({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? "development",
      tracesSampleRate: parseFloat(
        env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"
      ),
      sendDefaultPii: false,
      enableLogs: true,
      beforeSend,
      beforeSendTransaction,
    }),
    handler
  );
}
