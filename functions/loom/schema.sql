-- Loom's day counters. Applied once, by hand, against the D1 database bound to
-- the Pages project as LOOM:
--
--   npx wrangler d1 execute loom --remote --file functions/loom/schema.sql
--
-- Run it again after a change: every statement is IF NOT EXISTS, so tables
-- that are there are left alone and new ones are added.
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

-- The results of a phone's first day, counted a second time: loom_day less
-- this is the returning players. Written by scores.js when the phone says so.
CREATE TABLE IF NOT EXISTS loom_fresh (
  day   INTEGER PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0,
  lost  INTEGER NOT NULL DEFAULT 0
);

-- Opens: "of the phones that started on day FIRST, N opened day DAY, having
-- last opened Loom GAP days before" (GAP 0: a first day; -1: not said). Written
-- by opens.js. Players of a day are every row for DAY; new players GAP = 0; a
-- cohort's return is its rows by DAY; unique players over a run of days are the
-- rows whose GAP reaches back past the run's first day (see stats.sh).
CREATE TABLE IF NOT EXISTS loom_open (
  first INTEGER NOT NULL,
  day   INTEGER NOT NULL,
  gap   INTEGER NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (first, day, gap)
);

-- loom_cohort was the first shape of the table above, live for one morning
-- (13 October 2026) and holding one test phone. Nothing reads or writes it.
DROP TABLE IF EXISTS loom_cohort;

-- The three looms (from Loom versionCode 26): the same counts as loom_day, one
-- row per day and loom ('e' Easy, 'n' Normal, 'h' Hard), with eight attempt
-- columns (five tries and two extra weaves on Easy) and, beside them, the
-- results that were a phone's first day. Written by scores.js for a result
-- that names its loom; a build older than the looms still writes loom_day.
CREATE TABLE IF NOT EXISTS loom_result (
  day   INTEGER NOT NULL,
  tier  TEXT    NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  c1 INTEGER NOT NULL DEFAULT 0, c2 INTEGER NOT NULL DEFAULT 0,
  c3 INTEGER NOT NULL DEFAULT 0, c4 INTEGER NOT NULL DEFAULT 0,
  c5 INTEGER NOT NULL DEFAULT 0, c6 INTEGER NOT NULL DEFAULT 0,
  c7 INTEGER NOT NULL DEFAULT 0, c8 INTEGER NOT NULL DEFAULT 0,
  lost  INTEGER NOT NULL DEFAULT 0,
  t1 INTEGER NOT NULL DEFAULT 0, t2 INTEGER NOT NULL DEFAULT 0,
  t3 INTEGER NOT NULL DEFAULT 0, t4 INTEGER NOT NULL DEFAULT 0,
  t5 INTEGER NOT NULL DEFAULT 0, t6 INTEGER NOT NULL DEFAULT 0,
  fresh INTEGER NOT NULL DEFAULT 0,
  flost INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tier)
);
