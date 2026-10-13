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

-- Opens, by the day a phone first opened Loom: "of the phones that started on
-- day FIRST, N opened it on day DAY". Written by opens.js. Players of a day are
-- every row for that DAY, new players the row where FIRST = DAY, and a cohort's
-- return is its row at FIRST + 1, + 7 over its row at FIRST.
CREATE TABLE IF NOT EXISTS loom_cohort (
  first INTEGER NOT NULL,
  day   INTEGER NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (first, day)
);
