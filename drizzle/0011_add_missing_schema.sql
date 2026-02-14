-- Add missing columns to bugs table
ALTER TABLE bugs ADD COLUMN bug_type TEXT;
ALTER TABLE bugs ADD COLUMN confidence REAL;
ALTER TABLE bugs ADD COLUMN stack_trace TEXT;

-- Add missing columns to coverage_reports table
ALTER TABLE coverage_reports ADD COLUMN pr_number INTEGER;
ALTER TABLE coverage_reports ADD COLUMN pr_url TEXT;

-- Add missing columns to alert_history table
ALTER TABLE alert_history ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_history ADD COLUMN acknowledged_at TEXT;

-- Create security_findings table
CREATE TABLE security_findings (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT,
  vulnerability_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_number INTEGER,
  function_name TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  remediation TEXT,
  confidence REAL,
  cwe_id TEXT,
  evidence TEXT,
  detection_method TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_security_project ON security_findings(project_id, created_at);

-- Create risk_scores table
CREATE TABLE risk_scores (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT,
  file_path TEXT NOT NULL,
  overall_score REAL,
  complexity_score REAL,
  coverage_score REAL,
  recency_score REAL,
  criticality_score REAL,
  level TEXT,
  criticality_domains TEXT,
  avg_complexity REAL,
  coverage_percentage REAL,
  function_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_risk_project ON risk_scores(project_id, created_at);

-- Create coverage_gaps table
CREATE TABLE coverage_gaps (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT,
  file_path TEXT NOT NULL,
  function_name TEXT NOT NULL,
  line_number INTEGER,
  end_line INTEGER,
  coverage_percentage REAL,
  complexity INTEGER,
  is_public INTEGER,
  priority TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_gaps_project ON coverage_gaps(project_id, created_at);
CREATE INDEX idx_gaps_project_run ON coverage_gaps(project_id, run_id);

-- Create bug_fixes table
CREATE TABLE bug_fixes (
  id TEXT PRIMARY KEY NOT NULL,
  bug_id TEXT NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  patch TEXT,
  explanation TEXT,
  confidence REAL,
  safety_notes TEXT,
  verification_status TEXT,
  r2_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_fixes_bug ON bug_fixes(bug_id);
CREATE INDEX idx_fixes_project ON bug_fixes(project_id, created_at);

-- Create routes table
CREATE TABLE routes (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT,
  path TEXT NOT NULL,
  route_type TEXT,
  methods TEXT,
  handler_file TEXT,
  handler_name TEXT,
  handler_start_line INTEGER,
  handler_end_line INTEGER,
  params TEXT,
  framework TEXT,
  middleware TEXT,
  auth_required INTEGER,
  coverage_percentage REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_routes_project ON routes(project_id, created_at);

-- Create activity_log table
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  source TEXT,
  summary TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_activity_project ON activity_log(project_id, created_at);

-- Create doc_coverage table
CREATE TABLE doc_coverage (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT,
  file_path TEXT NOT NULL,
  function_name TEXT,
  has_docstring INTEGER,
  is_stale INTEGER,
  doc_framework TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_doc_project ON doc_coverage(project_id, created_at);
