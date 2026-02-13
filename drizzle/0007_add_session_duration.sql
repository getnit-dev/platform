-- Migration: Add session_id and duration_ms to usage_events
-- session_id groups LLM calls belonging to a single nit CLI run.
-- duration_ms tracks per-request LLM latency.

ALTER TABLE usage_events ADD COLUMN session_id TEXT;
ALTER TABLE usage_events ADD COLUMN duration_ms INTEGER;

CREATE INDEX idx_usage_events_session ON usage_events(session_id);
