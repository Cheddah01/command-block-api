-- command-block / D1 schema
-- Database: command-block-db
-- Run via: wrangler d1 execute command-block-db --file=schema.sql

CREATE TABLE plugins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version TEXT,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size_bytes INTEGER,
  notes TEXT,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  plugin TEXT,
  current_version_id INTEGER,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE config_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (config_id) REFERENCES configs(id)
);

-- Published plugins (public catalog) and their versioned jar releases.
-- Jars stored in R2 under published-jars/{slug}/{slug}-{version}.jar.
CREATE TABLE published_plugins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  description_md TEXT,
  mc_versions TEXT,
  source_url TEXT,
  support_url TEXT,
  current_version_id INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE published_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id INTEGER NOT NULL,
  version TEXT NOT NULL,
  changelog_md TEXT,
  mc_version TEXT,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (plugin_id) REFERENCES published_plugins(id)
);

CREATE INDEX idx_published_versions_plugin
  ON published_versions(plugin_id, created_at DESC);
