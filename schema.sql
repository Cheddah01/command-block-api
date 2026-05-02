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
