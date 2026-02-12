-- Add Resend email fields to alert_configs
ALTER TABLE `alert_configs` ADD COLUMN `resend_api_key` text;
ALTER TABLE `alert_configs` ADD COLUMN `email_from_address` text;
