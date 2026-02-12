PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  github_username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX uq_users_email ON users(email);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  scope TEXT,
  password TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_accounts_provider_account ON accounts(provider_id, account_id);
CREATE INDEX idx_accounts_user ON accounts(user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL,
  session_token TEXT,
  token_hash TEXT,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_sessions_token ON sessions(token);
CREATE UNIQUE INDEX uq_sessions_session_token ON sessions(session_token);
CREATE UNIQUE INDEX uq_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE verification_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX uq_verification_tokens_token ON verification_tokens(token);
CREATE UNIQUE INDEX uq_verification_identifier_token ON verification_tokens(identifier, token);

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  repo_url TEXT,
  repo_provider TEXT NOT NULL DEFAULT 'github',
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_projects_user ON projects(user_id);

CREATE TABLE packages (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  language TEXT,
  test_framework TEXT,
  doc_framework TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_packages_project_path ON packages(project_id, path);

CREATE TABLE coverage_reports (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  package_id TEXT,
  run_id TEXT NOT NULL,
  run_mode TEXT NOT NULL,
  branch TEXT,
  commit_sha TEXT,
  unit_coverage REAL,
  integration_coverage REAL,
  e2e_coverage REAL,
  overall_coverage REAL,
  tests_generated INTEGER NOT NULL DEFAULT 0,
  tests_passed INTEGER NOT NULL DEFAULT 0,
  tests_failed INTEGER NOT NULL DEFAULT 0,
  bugs_found INTEGER NOT NULL DEFAULT 0,
  bugs_fixed INTEGER NOT NULL DEFAULT 0,
  report_r2_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
);

CREATE INDEX idx_coverage_project ON coverage_reports(project_id, created_at);
CREATE INDEX idx_coverage_package ON coverage_reports(package_id, created_at);

CREATE TABLE drift_results (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  test_name TEXT NOT NULL,
  status TEXT NOT NULL,
  similarity_score REAL,
  baseline_output TEXT,
  current_output TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_drift_project ON drift_results(project_id, created_at);

CREATE TABLE bugs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  package_id TEXT,
  file_path TEXT NOT NULL,
  function_name TEXT,
  description TEXT NOT NULL,
  root_cause TEXT,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  github_issue_url TEXT,
  github_pr_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL
);

CREATE INDEX idx_bugs_project ON bugs(project_id, status);

CREATE TABLE virtual_keys (
  id TEXT PRIMARY KEY NOT NULL,
  key_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  models_allowed TEXT,
  max_budget REAL,
  budget_duration TEXT,
  rpm_limit INTEGER,
  tpm_limit INTEGER,
  spend_total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX idx_virtual_keys_hash ON virtual_keys(key_hash);
CREATE UNIQUE INDEX uq_virtual_keys_hash ON virtual_keys(key_hash);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  key_hash TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  margin_usd REAL NOT NULL DEFAULT 0,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX idx_usage_events_user_ts ON usage_events(user_id, timestamp);

CREATE TABLE usage_daily (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  model TEXT NOT NULL,
  date TEXT NOT NULL,
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX idx_usage_daily_user_date ON usage_daily(user_id, date);
CREATE UNIQUE INDEX uq_usage_daily_rollup ON usage_daily(user_id, project_id, model, date);
