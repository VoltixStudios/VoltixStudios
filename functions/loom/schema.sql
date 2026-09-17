-- Loom's day counters. Applied once, by hand, against the D1 database bound to
-- the Pages project as LOOM:
--
--   npx wrangler d1 execute loom --remote --file functions/loom/schema.sql
--
-- Counts only. There is no row here that belongs to a person; see scores.js.
CREATE TABLE IF NOT EXISTS loom_day (
  day   INTEGER PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0,
  c1    INTEGER NOT NULL DEFAULT 0,
  c2    INTEGER NOT NULL DEFAULT 0,
  c3    INTEGER NOT NULL DEFAULT 0,
  c4    INTEGER NOT NULL DEFAULT 0,
  c5    INTEGER NOT NULL DEFAULT 0,
  c6    INTEGER NOT NULL DEFAULT 0,
  lost  INTEGER NOT NULL DEFAULT 0,
  t1    INTEGER NOT NULL DEFAULT 0,
  t2    INTEGER NOT NULL DEFAULT 0,
  t3    INTEGER NOT NULL DEFAULT 0,
  t4    INTEGER NOT NULL DEFAULT 0,
  t5    INTEGER NOT NULL DEFAULT 0,
  t6    INTEGER NOT NULL DEFAULT 0
);

-- One row per phone per day, holding a hash and nothing else, so that a network
-- retry cannot count the same day twice. Deleted after a week.
CREATE TABLE IF NOT EXISTS loom_seen (
  day INTEGER NOT NULL,
  id  TEXT NOT NULL,
  PRIMARY KEY (day, id)
);
