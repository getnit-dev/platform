-- Drop unused virtual_keys table
DROP TABLE IF EXISTS virtual_keys;

-- Drop unused margin_usd column from usage_events
ALTER TABLE usage_events DROP COLUMN margin_usd;
