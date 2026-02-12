-- Alert configurations table
CREATE TABLE `alert_configs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `slack_webhook` text,
  `email_threshold_usd` real,
  `budget_alert_percent` real,
  `email_recipients` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  `updated_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `uq_alert_configs_project` ON `alert_configs` (`project_id`);

-- Alert history table
CREATE TABLE `alert_history` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `alert_type` text NOT NULL,
  `message` text NOT NULL,
  `threshold` real,
  `current_value` real,
  `sent` integer DEFAULT 0 NOT NULL,
  `sent_at` text,
  `error` text,
  `created_at` text DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_alert_history_project` ON `alert_history` (`project_id`, `created_at`);
