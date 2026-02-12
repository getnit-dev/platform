import * as Sentry from "@sentry/cloudflare";

type LogData = Record<string, string | number | boolean | null | undefined>;

function sanitizeLogData(data: LogData): LogData {
  const clean: LogData = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value.length > 200) {
      clean[key] = value.slice(0, 200) + "...[truncated]";
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

export const logger = {
  info(message: string, data?: LogData): void {
    const clean = data ? sanitizeLogData(data) : undefined;
    Sentry.logger.info(message, clean);
    console.log(`[INFO] ${message}`, clean ?? "");
  },

  warn(message: string, data?: LogData): void {
    const clean = data ? sanitizeLogData(data) : undefined;
    Sentry.logger.warn(message, clean);
    console.warn(`[WARN] ${message}`, clean ?? "");
  },

  error(message: string, data?: LogData): void {
    const clean = data ? sanitizeLogData(data) : undefined;
    Sentry.logger.error(message, clean);
    console.error(`[ERROR] ${message}`, clean ?? "");
  },

  debug(message: string, data?: LogData): void {
    const clean = data ? sanitizeLogData(data) : undefined;
    Sentry.logger.debug(message, clean);
  },
};
