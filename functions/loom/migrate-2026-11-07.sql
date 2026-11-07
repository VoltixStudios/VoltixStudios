-- Run once on the live database, BEFORE the scores.js of 7 November 2026 is
-- deployed (that file writes these two columns, and fails without them):
--
--   npx wrangler d1 execute loom --remote --file functions/loom/migrate-2026-11-07.sql
--
-- A new database does not need it: schema.sql already has both columns.
ALTER TABLE loom_seen ADD COLUMN lv INTEGER;
ALTER TABLE loom_seen ADD COLUMN cc TEXT;
