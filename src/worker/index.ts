import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { checkAlerts } from "./lib/alerting";
import { handleAuthRequest } from "./lib/auth";
import { resetVirtualKeyBudgets } from "./lib/budget";
import { aggregateDriftDaily, cleanupDriftData } from "./lib/drift-rollup";
import { wrapWithSentry } from "./lib/sentry";
import { aggregateUsageDaily, cleanupUsageData } from "./lib/usage-rollup";
import { authMiddleware } from "./middleware/auth";
import { corsMiddleware } from "./middleware/cors";
import { flexAuthMiddleware } from "./middleware/flex-auth";
import { sentryMiddleware } from "./middleware/sentry";
import alertConfigRoutes from "./routes/alert-config";
import { bugRoutes } from "./routes/bugs";
import { driftRoutes } from "./routes/drift";
import { llmKeyRoutes } from "./routes/llm-keys";
import { llmProxyRoutes } from "./routes/llm-proxy";
import { llmUsageRoutes } from "./routes/llm-usage";
import { platformKeyRoutes } from "./routes/platform-keys";
import { projectRoutes } from "./routes/projects";
import { memoryRoutes } from "./routes/memory";
import { reportRoutes } from "./routes/reports";
import { uploadRoutes } from "./routes/upload";
import { usageIngestRoutes } from "./routes/usage-ingest";
import { webhookRoutes } from "./routes/webhooks";
import { consumeUsageEventsBatch } from "./queues/usage-consumer";
import type { AppBindings, AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("/api/*", corsMiddleware);
app.use("/api/*", sentryMiddleware);

app.all("/api/auth", (c) => {
  return handleAuthRequest(c.req.raw, c.env);
});

app.all("/api/auth/*", (c) => {
  return handleAuthRequest(c.req.raw, c.env);
});

// Session-only auth for dashboard-only routes
for (const path of [
  "/api/projects",
  "/api/llm-keys",
  "/api/llm-usage",
  "/api/alert-config",
  "/api/platform-keys"
]) {
  app.use(path, authMiddleware);
  app.use(`${path}/*`, authMiddleware);
}

// Flex auth (API key OR session) for routes used by both CLI and dashboard
for (const path of ["/api/v1/reports", "/api/v1/upload", "/api/v1/drift", "/api/v1/bugs", "/api/v1/memory"]) {
  app.use(path, flexAuthMiddleware);
  app.use(`${path}/*`, flexAuthMiddleware);
}

app.get("/api/health", (c) => {
  return c.json({ status: "ok", service: "nit-platform" });
});

app.get("/api/dashboard/me", authMiddleware, (c) => {
  const auth = c.get("auth");

  return c.json({
    userId: auth.userId,
    email: auth.email,
    name: auth.name
  });
});

app.route("/api/v1/llm-proxy", llmProxyRoutes);
app.route("/api/v1/usage", usageIngestRoutes);
app.route("/api/v1/reports", reportRoutes);
app.route("/api/v1/drift", driftRoutes);
app.route("/api/v1/bugs", bugRoutes);
app.route("/api/v1/memory", memoryRoutes);
app.route("/api/v1/upload", uploadRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/webhooks", webhookRoutes);
app.route("/api/llm-keys", llmKeyRoutes);
app.route("/api/llm-usage", llmUsageRoutes);
app.route("/api/alert-config", alertConfigRoutes);
app.route("/api/platform-keys", platformKeyRoutes);

const worker: ExportedHandler<AppBindings> = {
  fetch: app.fetch,

  async queue(batch, env) {
    Sentry.setTag("handler", "queue");
    Sentry.setTag("batch_size", String(batch.messages.length));

    try {
      await consumeUsageEventsBatch(batch, { DB: env.DB });
      Sentry.metrics.count("queue.usage.batch_processed", 1);
      Sentry.metrics.distribution(
        "queue.usage.batch_size",
        batch.messages.length
      );
    } catch (error) {
      Sentry.metrics.count("queue.usage.batch_failed", 1);
      Sentry.captureException(error);
      throw error;
    }
  },

  async scheduled(_controller, env) {
    Sentry.setTag("handler", "scheduled");
    Sentry.metrics.count("cron.execution", 1);
    await aggregateUsageDaily({ DB: env.DB });
    await aggregateDriftDaily({ DB: env.DB, KV: env.KV });

    await resetVirtualKeyBudgets({
      DB: env.DB,
      KV: env.KV
    });

    await cleanupUsageData({
      DB: env.DB,
      USAGE_EVENTS_RETENTION_DAYS: env.USAGE_EVENTS_RETENTION_DAYS,
      USAGE_DAILY_RETENTION_DAYS: env.USAGE_DAILY_RETENTION_DAYS
    });

    await cleanupDriftData({
      DB: env.DB,
      DRIFT_RETENTION_DAYS: env.DRIFT_RETENTION_DAYS
    });

    // Check and send alerts
    await checkAlerts({ DB: env.DB });
  }
};

export default wrapWithSentry(worker);
