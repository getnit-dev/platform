import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Alert configuration for project monitoring and notifications.
 */
export interface AlertConfig {
  /** Slack webhook URL for sending notifications */
  slackWebhook: string;
  /** Email threshold in USD for triggering cost alerts */
  emailThresholdUsd: string;
  /** Budget alert threshold as a percentage (0-100) */
  budgetAlertPercent: string;
  /** Comma-separated list of email recipients for alerts */
  emailRecipients: string;
  /** Resend API key for sending emails */
  resendApiKey: string;
  /** Email from address (must be verified in Resend) */
  emailFromAddress: string;
}

/** Default alert configuration values */
export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  slackWebhook: "",
  emailThresholdUsd: "250",
  budgetAlertPercent: "85",
  emailRecipients: "",
  resendApiKey: "",
  emailFromAddress: ""
};

/**
 * Load alert configuration for a project from the server
 * @param projectId - The project ID to load config for
 * @returns The alert configuration, or defaults if none exists
 */
export async function loadAlertConfig(projectId: string): Promise<AlertConfig> {
  try {
    const response = await api.alertConfig.get(projectId);
    const config = response.config;

    return {
      slackWebhook: config.slackWebhook || "",
      emailThresholdUsd: config.emailThresholdUsd?.toString() || "250",
      budgetAlertPercent: config.budgetAlertPercent?.toString() || "85",
      emailRecipients: config.emailRecipients || "",
      resendApiKey: config.resendApiKey || "",
      emailFromAddress: config.emailFromAddress || ""
    };
  } catch {
    return DEFAULT_ALERT_CONFIG;
  }
}

/**
 * Save alert configuration for a project to the server
 * @param projectId - The project ID to save config for
 * @param config - The alert configuration to save
 */
export async function saveAlertConfig(projectId: string, config: AlertConfig): Promise<void> {
  await api.alertConfig.update(projectId, {
    slackWebhook: config.slackWebhook || null,
    emailThresholdUsd: config.emailThresholdUsd ? parseFloat(config.emailThresholdUsd) : null,
    budgetAlertPercent: config.budgetAlertPercent ? parseFloat(config.budgetAlertPercent) : null,
    emailRecipients: config.emailRecipients || null,
    resendApiKey: config.resendApiKey || null,
    emailFromAddress: config.emailFromAddress || null
  });
}

/**
 * Validate alert configuration values
 * @param config - The alert configuration to validate
 * @returns Validation errors, or null if valid
 */
export function validateAlertConfig(config: AlertConfig): string | null {
  // Validate email threshold
  const emailThreshold = parseFloat(config.emailThresholdUsd);
  if (config.emailThresholdUsd && (isNaN(emailThreshold) || emailThreshold < 0)) {
    return "Email threshold must be a positive number";
  }

  // Validate budget alert percent
  const budgetPercent = parseFloat(config.budgetAlertPercent);
  if (config.budgetAlertPercent && (isNaN(budgetPercent) || budgetPercent < 0 || budgetPercent > 100)) {
    return "Budget alert percentage must be between 0 and 100";
  }

  // Validate Slack webhook URL format (if provided)
  if (config.slackWebhook && !config.slackWebhook.startsWith("https://hooks.slack.com/")) {
    return "Slack webhook must be a valid Slack webhook URL";
  }

  return null;
}

/**
 * Parse alert configuration into typed values
 * @param config - The alert configuration to parse
 * @returns Parsed configuration with numeric values
 */
export interface ParsedAlertConfig {
  slackWebhook: string | null;
  emailThresholdUsd: number | null;
  budgetAlertPercent: number | null;
  emailRecipients: string[];
}

export function parseAlertConfig(config: AlertConfig): ParsedAlertConfig {
  const emailThreshold = parseFloat(config.emailThresholdUsd);
  const budgetPercent = parseFloat(config.budgetAlertPercent);

  return {
    slackWebhook: config.slackWebhook.trim() || null,
    emailThresholdUsd: !isNaN(emailThreshold) && emailThreshold > 0 ? emailThreshold : null,
    budgetAlertPercent: !isNaN(budgetPercent) && budgetPercent > 0 ? budgetPercent : null,
    emailRecipients: config.emailRecipients
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean)
  };
}

/**
 * React hook for managing alert configuration with automatic persistence
 *
 * @param projectId - The project ID to load/save config for
 * @returns Tuple of [config, setConfig, validationError, loading]
 *
 * @example
 * ```tsx
 * function SettingsPanel({ projectId }: { projectId: string }) {
 *   const [alertConfig, setAlertConfig, validationError, loading] = useAlertConfig(projectId);
 *
 *   if (loading) return <div>Loading...</div>;
 *
 *   return (
 *     <div>
 *       <input
 *         value={alertConfig.slackWebhook}
 *         onChange={(e) => setAlertConfig({ ...alertConfig, slackWebhook: e.target.value })}
 *       />
 *       {validationError && <p>{validationError}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAlertConfig(projectId: string): [
  AlertConfig,
  (config: AlertConfig | ((prev: AlertConfig) => AlertConfig)) => void,
  string | null,
  boolean
] {
  const [config, setConfig] = useState<AlertConfig>(DEFAULT_ALERT_CONFIG);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load config on mount
  useEffect(() => {
    let active = true;

    loadAlertConfig(projectId)
      .then((loadedConfig) => {
        if (active) {
          setConfig(loadedConfig);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setConfig(DEFAULT_ALERT_CONFIG);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [projectId]);

  // Save config on change (debounced)
  useEffect(() => {
    if (loading) return;

    const error = validateAlertConfig(config);
    setValidationError(error);

    if (!error) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        saveAlertConfig(projectId, config).catch(console.error);
      }, 500);
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [config, projectId, loading]);

  return [config, setConfig, validationError, loading];
}

