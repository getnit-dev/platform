-- Project-level global memory (one row per project)
CREATE TABLE project_memory (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  conventions TEXT,
  known_patterns TEXT,
  failed_patterns TEXT,
  generation_stats TEXT,
  source TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX uq_project_memory_project ON project_memory(project_id);

-- Package-level memory (one row per project + package)
CREATE TABLE package_memory (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  package_name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  test_patterns TEXT,
  known_issues TEXT,
  coverage_history TEXT,
  llm_feedback TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX uq_package_memory_project_pkg ON package_memory(project_id, package_name);
