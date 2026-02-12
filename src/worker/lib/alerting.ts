import { nanoid } from "nanoid";
import type { AppBindings } from "../types";
import { logger } from "./logger";

/**
 * Check all projects for alert conditions and send notifications
 */
export async function checkAlerts(env: Pick<AppBindings, "DB">): Promise<void> {
  // Get all alert configs
  const configs = await env.DB.prepare("SELECT * FROM alert_configs").all();

  if (!configs.results || configs.results.length === 0) {
    return;
  }

  for (const config of configs.results) {
    try {
      await checkProjectAlerts(env.DB, config);
    } catch (error) {
      logger.error("alert_check_failed", {
        projectId: String(config.project_id),
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

/**
 * Check alerts for a single project
 */
async function checkProjectAlerts(
  db: D1Database,
  config: Record<string, unknown>
): Promise<void> {
  // Skip if no alerting is configured
  if (!config.slack_webhook && !config.email_recipients) {
    return;
  }

  // Check budget alerts
  if (config.budget_alert_percent) {
    await checkBudgetAlerts(db, config);
  }

  // Check spending threshold alerts
  if (config.email_threshold_usd) {
    await checkSpendingAlerts(db, config);
  }
}

/**
 * Check if any virtual keys are approaching their budget limit
 */
async function checkBudgetAlerts(
  db: D1Database,
  config: Record<string, unknown>
): Promise<void> {
  const budgetPercent = Number(config.budget_alert_percent);
  if (!budgetPercent) return;

  // Get all keys for this project with budgets
  const keys = await db
    .prepare(
      `SELECT * FROM virtual_keys
       WHERE project_id = ?
         AND revoked = 0
         AND max_budget IS NOT NULL
         AND max_budget > 0`
    )
    .bind(config.project_id)
    .all();

  if (!keys.results) return;

  for (const key of keys.results) {
    const maxBudget = Number(key.max_budget);
    const spendTotal = Number(key.spend_total);

    if (!maxBudget) continue;

    const percentUsed = (spendTotal / maxBudget) * 100;

    if (percentUsed >= budgetPercent) {
      // Check if we already sent this alert recently (within last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const keyPrefix = String(key.key_hash).slice(0, 8);

      const recentAlert = await db
        .prepare(
          `SELECT id FROM alert_history
           WHERE project_id = ?
             AND alert_type = 'budget_threshold'
             AND created_at >= ?
             AND message LIKE ?
           LIMIT 1`
        )
        .bind(config.project_id, oneDayAgo, `%${keyPrefix}%`)
        .first();

      if (recentAlert) {
        continue; // Already alerted recently
      }

      const message = `⚠️ Budget Alert: Virtual key ${keyPrefix}... has used ${percentUsed.toFixed(1)}% of its budget ($${spendTotal.toFixed(2)} / $${maxBudget.toFixed(2)})`;

      await sendAlert(db, config, {
        alertType: "budget_threshold",
        message,
        threshold: budgetPercent,
        currentValue: percentUsed
      });
    }
  }
}

/**
 * Check if total spending has exceeded the threshold
 */
async function checkSpendingAlerts(
  db: D1Database,
  config: Record<string, unknown>
): Promise<void> {
  const emailThreshold = Number(config.email_threshold_usd);
  if (!emailThreshold) return;

  // Calculate total spending for this project in the last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const result = await db
    .prepare(
      `SELECT SUM(total_cost_usd) as total
       FROM usage_daily
       WHERE project_id = ?
         AND date >= ?`
    )
    .bind(config.project_id, thirtyDaysAgo)
    .first();

  const totalSpending = Number(result?.total || 0);

  if (totalSpending >= emailThreshold) {
    // Check if we already sent this alert recently (within last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const recentAlert = await db
      .prepare(
        `SELECT id FROM alert_history
         WHERE project_id = ?
           AND alert_type = 'spending_threshold'
           AND created_at >= ?
         LIMIT 1`
      )
      .bind(config.project_id, oneDayAgo)
      .first();

    if (recentAlert) {
      return; // Already alerted recently
    }

    const message = `💰 Spending Alert: Project spending in the last 30 days has reached $${totalSpending.toFixed(2)} (threshold: $${emailThreshold.toFixed(2)})`;

    await sendAlert(db, config, {
      alertType: "spending_threshold",
      message,
      threshold: emailThreshold,
      currentValue: totalSpending
    });
  }
}

/**
 * Send an alert via configured channels
 */
async function sendAlert(
  db: D1Database,
  config: Record<string, unknown>,
  alert: {
    alertType: string;
    message: string;
    threshold: number;
    currentValue: number;
  }
): Promise<void> {
  const now = new Date().toISOString();
  let sent = false;
  let error: string | null = null;

  try {
    // Send to Slack if configured
    if (config.slack_webhook) {
      await fetch(String(config.slack_webhook), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: alert.message })
      });
    }

    // Send email via Resend if configured
    if (config.email_recipients && config.resend_api_key && config.email_from_address) {
      const recipients = String(config.email_recipients)
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean);

      if (recipients.length > 0) {
        await sendEmailViaResend({
          apiKey: String(config.resend_api_key),
          from: String(config.email_from_address),
          to: recipients,
          subject: getEmailSubject(alert.alertType),
          message: alert.message,
          alertType: alert.alertType,
          threshold: alert.threshold,
          currentValue: alert.currentValue
        });
      }
    }

    sent = true;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
    logger.error("alert_send_failed", {
      alertType: alert.alertType,
      error,
    });
  }

  // Record alert in history
  await db
    .prepare(
      `INSERT INTO alert_history (
        id, project_id, alert_type, message, threshold, current_value,
        sent, sent_at, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      nanoid(),
      config.project_id,
      alert.alertType,
      alert.message,
      alert.threshold,
      alert.currentValue,
      sent ? 1 : 0,
      sent ? now : null,
      error,
      now
    )
    .run();
}

/**
 * Get email subject based on alert type
 */
function getEmailSubject(alertType: string): string {
  switch (alertType) {
    case "budget_threshold":
      return "⚠️ Budget Alert - Threshold Exceeded";
    case "spending_threshold":
      return "💰 Spending Alert - Threshold Exceeded";
    default:
      return "🔔 Platform Alert";
  }
}

/**
 * Send email via Resend API
 */
async function sendEmailViaResend(params: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  message: string;
  alertType: string;
  threshold: number;
  currentValue: number;
}): Promise<void> {
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${params.subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px; text-align: center;">
      <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 600;">${params.subject}</h1>
    </div>

    <div style="padding: 32px;">
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
        <p style="margin: 0; color: #991b1b; font-size: 16px; line-height: 1.5;">${params.message}</p>
      </div>

      <table style="width: 100%; margin-bottom: 24px; border-collapse: collapse;">
        <tr>
          <td style="padding: 12px; background-color: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600; color: #374151;">Threshold:</td>
          <td style="padding: 12px; background-color: #ffffff; border: 1px solid #e5e7eb; color: #1f2937;">${params.alertType.includes("budget") ? params.threshold + "%" : "$" + params.threshold.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 12px; background-color: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600; color: #374151;">Current Value:</td>
          <td style="padding: 12px; background-color: #ffffff; border: 1px solid #e5e7eb; color: #1f2937;">${params.alertType.includes("budget") ? params.currentValue.toFixed(1) + "%" : "$" + params.currentValue.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 12px; background-color: #f9fafb; border: 1px solid #e5e7eb; font-weight: 600; color: #374151;">Alert Type:</td>
          <td style="padding: 12px; background-color: #ffffff; border: 1px solid #e5e7eb; color: #1f2937;">${params.alertType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</td>
        </tr>
      </table>

      <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 0;">
        This is an automated alert from your platform monitoring system. Please review your project settings if you believe this alert was triggered in error.
      </p>
    </div>

    <div style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; color: #6b7280; font-size: 12px;">
        Sent by nit Platform Monitoring
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${params.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: htmlBody,
      text: params.message
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend API error: ${response.status} ${errorText}`);
  }
}
