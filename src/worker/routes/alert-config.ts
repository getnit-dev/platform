import { Hono } from "hono";
import { nanoid } from "nanoid";
import type { AppEnv } from "../types";
import { getRequestActor } from "../lib/access";

const app = new Hono<AppEnv>();

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
  const config = await c.env.DB.prepare(
    "SELECT * FROM alert_configs WHERE project_id = ?"
  )
    .bind(projectId)
    .first();

  if (!config) {
    // Return default config if none exists
    return c.json({
      config: {
        id: null,
        projectId,
        slackWebhook: null,
        emailThresholdUsd: null,
        budgetAlertPercent: null,
        emailRecipients: null,
        resendApiKey: null,
        emailFromAddress: null,
        createdAt: null,
        updatedAt: null
      }
    });
  }

  return c.json({ config });
});

// Upsert alert config
app.put("/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const actor = getRequestActor(c);
  const body = await c.req.json();

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

  if (body.slackWebhook && !body.slackWebhook.startsWith("https://hooks.slack.com/")) {
    return c.json({ error: "Invalid Slack webhook URL" }, 400);
  }

  // Check if config exists
  const existing = await c.env.DB.prepare(
    "SELECT id FROM alert_configs WHERE project_id = ?"
  )
    .bind(projectId)
    .first();

  const now = new Date().toISOString();

  if (existing) {
    // Update existing config
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
        body.slackWebhook || null,
        body.emailThresholdUsd ? Number(body.emailThresholdUsd) : null,
        body.budgetAlertPercent ? Number(body.budgetAlertPercent) : null,
        body.emailRecipients || null,
        body.resendApiKey || null,
        body.emailFromAddress || null,
        now,
        existing.id
      )
      .run();
  } else {
    // Insert new config
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
        body.slackWebhook || null,
        body.emailThresholdUsd ? Number(body.emailThresholdUsd) : null,
        body.budgetAlertPercent ? Number(body.budgetAlertPercent) : null,
        body.emailRecipients || null,
        body.resendApiKey || null,
        body.emailFromAddress || null,
        now,
        now
      )
      .run();
  }

  return c.json({ success: true });
});

export default app;
