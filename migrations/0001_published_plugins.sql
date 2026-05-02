-- Adds the published-plugins admin tables.
-- Apply with:
--   wrangler d1 migrations apply command-block-db --remote

CREATE TABLE IF NOT EXISTS published_plugins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  description_md TEXT,
  mc_versions TEXT,
  source_url TEXT,
  support_url TEXT,
  current_version_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS published_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  changelog_md TEXT,
  mc_version TEXT,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (plugin_id) REFERENCES published_plugins(id)
);

CREATE INDEX IF NOT EXISTS idx_published_versions_plugin
  ON published_versions(plugin_id, created_at DESC);
