import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { AppEnv } from "../types";
import { getRequestActor } from "../lib/access";
import { isRecord } from "../lib/validation";

interface AlertConfigRow {
  id: string;
  project_id: string;
  slack_webhook: string | null;
  email_threshold_usd: number | null;
  budget_alert_percent: number | null;
  email_recipients: string | null;
  resend_api_key: string | null;
  email_from_address: string | null;
  created_at: string;
  updated_at: string;
}

function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••••••";
  return value.slice(0, 4) + "••••" + value.slice(-4);
}

function mapRowToConfig(row: AlertConfigRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    slackWebhook: maskSecret(row.slack_webhook),
    slackWebhookConfigured: Boolean(row.slack_webhook),
    emailThresholdUsd: row.email_threshold_usd,
    budgetAlertPercent: row.budget_alert_percent,
    emailRecipients: row.email_recipients,
    resendApiKey: maskSecret(row.resend_api_key),
    resendApiKeyConfigured: Boolean(row.resend_api_key),
    emailFromAddress: row.email_from_address,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export const alertConfigRoutes = new Hono<AppEnv>();
const app = alertConfigRoutes;

// Get alert config for a project
app.get("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const actor = getRequestActor(c);

  if (!actor || actor.mode !== "session") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Check project access
  const project = await c.env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND user_id = ?"
  )
    .bind(projectId, actor.userId)
    .first();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  // Get alert config
  const row = await c.env.DB.prepare(
    "SELECT * FROM alert_configs WHERE project_id = ?"
  )
    .bind(projectId)
    .first<AlertConfigRow>();

  if (!row) {
    // Return default config if none exists
    return c.json({
      config: {
        id: null,
        projectId,
        slackWebhook: null,
        slackWebhookConfigured: false,
        emailThresholdUsd: null,
        budgetAlertPercent: null,
        emailRecipients: null,
        resendApiKey: null,
        resendApiKeyConfigured: false,
        emailFromAddress: null,
        createdAt: null,
        updatedAt: null
      }
    });
  }

  return c.json({ config: mapRowToConfig(row) });
});

// Upsert alert config
app.put("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const actor = getRequestActor(c);

  if (!actor || actor.mode !== "session") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Check project access
  const project = await c.env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND user_id = ?"
  )
    .bind(projectId, actor.userId)
    .first();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<unknown>();
  if (!isRecord(body)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  // Validate input
  if (body.emailThresholdUsd !== null && body.emailThresholdUsd !== undefined) {
    const threshold = Number(body.emailThresholdUsd);
    if (isNaN(threshold) || threshold < 0) {
      return c.json({ error: "Email threshold must be a positive number" }, 400);
    }
  }

  if (body.budgetAlertPercent !== null && body.budgetAlertPercent !== undefined) {
    const percent = Number(body.budgetAlertPercent);
    if (isNaN(percent) || percent < 0 || percent > 100) {
      return c.json({ error: "Budget alert percent must be between 0 and 100" }, 400);
    }
  }

  if (typeof body.slackWebhook === "string" && body.slackWebhook && !body.slackWebhook.startsWith("https://hooks.slack.com/")) {
    return c.json({ error: "Invalid Slack webhook URL" }, 400);
  }

  // Check if config exists (fetch secrets to preserve when masked values are sent back)
  const existing = await c.env.DB.prepare(
    "SELECT id, slack_webhook, resend_api_key FROM alert_configs WHERE project_id = ?"
  )
    .bind(projectId)
    .first<{ id: string; slack_webhook: string | null; resend_api_key: string | null }>();

  const now = new Date().toISOString();

  // For secrets, only update if a new non-masked value is provided
  const slackWebhook = typeof body.slackWebhook === "string" && !body.slackWebhook.includes("••••")
    ? (body.slackWebhook || null)
    : existing?.slack_webhook ?? null;

  const resendApiKey = typeof body.resendApiKey === "string" && !body.resendApiKey.includes("••••")
    ? (body.resendApiKey || null)
    : existing?.resend_api_key ?? null;

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE alert_configs
       SET slack_webhook = ?,
           email_threshold_usd = ?,
           budget_alert_percent = ?,
           email_recipients = ?,
           resend_api_key = ?,
           email_from_address = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(
        slackWebhook,
        body.emailThresholdUsd ? Number(body.emailThresholdUsd) : null,
        body.budgetAlertPercent ? Number(body.budgetAlertPercent) : null,
        typeof body.emailRecipients === "string" ? body.emailRecipients : null,
        resendApiKey,
        typeof body.emailFromAddress === "string" ? body.emailFromAddress : null,
        now,
        existing.id
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO alert_configs (
        id, project_id, slack_webhook, email_threshold_usd,
        budget_alert_percent, email_recipients, resend_api_key,
        email_from_address, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        nanoid(),
        projectId,
        slackWebhook,
        body.emailThresholdUsd ? Number(body.emailThresholdUsd) : null,
        body.budgetAlertPercent ? Number(body.budgetAlertPercent) : null,
        typeof body.emailRecipients === "string" ? body.emailRecipients : null,
        resendApiKey,
        typeof body.emailFromAddress === "string" ? body.emailFromAddress : null,
        now,
        now
      )
      .run();
  }

  return c.json({ success: true });
});

// DELETE handler
app.delete("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const actor = getRequestActor(c);

  if (!actor || actor.mode !== "session") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const project = await c.env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND user_id = ?"
  )
    .bind(projectId, actor.userId)
    .first();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM alert_configs WHERE project_id = ?")
    .bind(projectId)
    .run();

  return c.json({ deleted: true });
});
