-- Adds download counters used by the public catalog routes.
-- Apply with:
--   wrangler d1 migrations apply command-block-db --remote

ALTER TABLE published_plugins  ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE published_versions ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
