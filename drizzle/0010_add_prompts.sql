-- Prompt records for LLM prompt tracking, lineage, and comparison
CREATE TABLE IF NOT EXISTS prompt_records (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id TEXT,
  model TEXT NOT NULL,
  messages TEXT NOT NULL,
  temperature REAL,
  max_tokens INTEGER,
  metadata TEXT,
  response_text TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  source_file TEXT,
  template_name TEXT,
  builder_name TEXT,
  framework TEXT,
  context_tokens INTEGER,
  outcome TEXT DEFAULT 'pending',
  validation_attempts INTEGER DEFAULT 0,
  error_message TEXT,
  comparison_group_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_project ON prompt_records(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prompt_model ON prompt_records(model);
CREATE INDEX IF NOT EXISTS idx_prompt_template ON prompt_records(template_name);
CREATE INDEX IF NOT EXISTS idx_prompt_comparison ON prompt_records(comparison_group_id);
