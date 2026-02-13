-- Add missing indexes for common query patterns

-- usage_events: rollup query scans by timestamp without user_id filter
CREATE INDEX IF NOT EXISTS idx_usage_events_timestamp ON usage_events(timestamp);

-- usage_events: project-scoped queries in usage routes
CREATE INDEX IF NOT EXISTS idx_usage_events_project_ts ON usage_events(project_id, timestamp);

-- drift_results: cleanup query in drift-rollup deletes by created_at
CREATE INDEX IF NOT EXISTS idx_drift_results_created ON drift_results(created_at);

-- coverage_reports: LLM token aggregation in projects list query
CREATE INDEX IF NOT EXISTS idx_coverage_reports_project_commit ON coverage_reports(project_id, commit_sha);

-- platform_api_keys: lookup by user + project for key listing
CREATE INDEX IF NOT EXISTS idx_platform_api_keys_user_project ON platform_api_keys(user_id, project_id);
