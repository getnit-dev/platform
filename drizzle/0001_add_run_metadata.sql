-- Migration: Add LLM usage tracking and run metadata to coverage_reports
-- This adds fields to track model, tokens, cost, execution time, and other monitoring data

ALTER TABLE coverage_reports ADD COLUMN llm_provider TEXT;
ALTER TABLE coverage_reports ADD COLUMN llm_model TEXT;
ALTER TABLE coverage_reports ADD COLUMN llm_prompt_tokens INTEGER DEFAULT 0;
ALTER TABLE coverage_reports ADD COLUMN llm_completion_tokens INTEGER DEFAULT 0;
ALTER TABLE coverage_reports ADD COLUMN llm_total_tokens INTEGER DEFAULT 0;
ALTER TABLE coverage_reports ADD COLUMN llm_cost_usd REAL DEFAULT 0;
ALTER TABLE coverage_reports ADD COLUMN execution_time_ms INTEGER;
ALTER TABLE coverage_reports ADD COLUMN execution_environment TEXT;
ALTER TABLE coverage_reports ADD COLUMN run_metadata TEXT;
