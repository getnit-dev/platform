CREATE TABLE platform_api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  key_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT,
  last_used_at TEXT,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_platform_api_keys_hash ON platform_api_keys(key_hash);
CREATE UNIQUE INDEX uq_platform_api_keys_hash ON platform_api_keys(key_hash);
CREATE INDEX idx_platform_api_keys_user ON platform_api_keys(user_id);
