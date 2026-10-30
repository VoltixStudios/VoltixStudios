-- Voltix Analytics (D-072). Applied by hand against the D1 database bound to
-- the Pages project as VA:
--
--   npx wrangler d1 execute va --remote --file functions/va/schema.sql
--
-- Run it again after a change: every statement is IF NOT EXISTS.
--
-- What a row may hold is settled in D-074: a random install id the game made up
-- for itself, and what the game did. Never a name, an e-mail, an advertising
-- id, a device id or an IP address.

-- One row per batch the game sent: the batch's events as a JSON array, so that
-- thirty events cost one row written and not thirty (D1's free plan counts
-- rows). Kept 90 days, then deleted by the nightly Worker; everything the
-- dashboard shows is read from the summaries, which are kept for good.
CREATE TABLE IF NOT EXISTS va_batch (
  id       INTEGER PRIMARY KEY,
  game     TEXT    NOT NULL,
  install  TEXT    NOT NULL,
  platform TEXT    NOT NULL,              -- 'app' or 'web' (the copy at /loom/play/)
  vc       INTEGER,                       -- version code the batch was sent from
  day      INTEGER NOT NULL,              -- the day it arrived, days since 1 January 2026, UTC
  received INTEGER NOT NULL,              -- ms
  country  TEXT,                          -- two letters from Cloudflare; never the address
  n        INTEGER NOT NULL,              -- events kept
  refused  INTEGER NOT NULL DEFAULT 0,    -- events refused by the collector's rules
  events   TEXT    NOT NULL               -- [{n,t,s,q,d,x,u}], see functions/collect/index.js
);
CREATE INDEX IF NOT EXISTS va_batch_day     ON va_batch (game, day);
CREATE INDEX IF NOT EXISTS va_batch_install ON va_batch (game, install);

-- One row per install: where it came from, what it runs on, when it was first
-- and last heard from. Kept for good, deleted only on the player's request.
CREATE TABLE IF NOT EXISTS va_install (
  game         TEXT    NOT NULL,
  install      TEXT    NOT NULL,
  platform     TEXT    NOT NULL,
  first_seen   INTEGER NOT NULL,          -- ms, the first batch's arrival
  first_day    INTEGER,                   -- the game's own first day, as the game recorded it
  last_seen    INTEGER NOT NULL,
  vc_first     INTEGER,
  vc_last      INTEGER,
  country      TEXT,
  src_source   TEXT,                      -- Play Install Referrer (D-073)
  src_medium   TEXT,
  src_campaign TEXT,
  dev_model    TEXT,
  dev_os       TEXT,
  dev_webview  TEXT,
  dev_lang     TEXT,
  dev_screen   TEXT,
  batches      INTEGER NOT NULL DEFAULT 0,
  events       INTEGER NOT NULL DEFAULT 0,
  cap_day      INTEGER,                   -- the day cap_n counts for
  cap_n        INTEGER NOT NULL DEFAULT 0,-- events accepted from this install that day
  tester       INTEGER,                   -- 1: a test install (Google's pre-launch robots,
                                          -- marked by hand or by the nightly rule); its
                                          -- events count under Tests, never Players
  PRIMARY KEY (game, install)
);
-- A database made before 30 October 2026 lacks `tester`; add it once with:
--   ALTER TABLE va_install ADD COLUMN tester INTEGER;

-- One row per purchase the game reported. verified = 1 only when Google's
-- signature checked out against the game's licence key; revenue counts only
-- those. The purchase token itself is never stored.
CREATE TABLE IF NOT EXISTS va_purchase (
  id            TEXT    PRIMARY KEY,      -- Google's order id, or a hash of the token when there is none
  game          TEXT    NOT NULL,
  install       TEXT    NOT NULL,
  sku           TEXT,
  price_micros  INTEGER,
  currency      TEXT,
  purchase_time INTEGER,                  -- ms, as Google signed it
  verified      INTEGER NOT NULL DEFAULT 0,
  received      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS va_purchase_game ON va_purchase (game, purchase_time);

-- Login attempts, for the lockout and the Health page. `who` is a keyed hash
-- of the address, never the address. Deleted after a day.
CREATE TABLE IF NOT EXISTS va_login (
  at  INTEGER NOT NULL,                   -- ms
  who TEXT    NOT NULL,
  ok  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS va_login_at ON va_login (at);

-- Deletions a player asked for: how many per day and game, never whose.
CREATE TABLE IF NOT EXISTS va_deleted (
  day  INTEGER NOT NULL,
  game TEXT    NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, game)
);

-- Small settings and markers: the last authenticator step used, so one code
-- cannot log in twice.
CREATE TABLE IF NOT EXISTS va_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- ---------------------------------------------------------------------------
-- The summaries, written only by the nightly Worker (workers/va-nightly). The
-- dashboard reads these and never the raw batches, which are deleted after 90
-- days; these are kept for good. Each night recalculates the last three days
-- and today, because a phone may hold events offline for up to 72 hours.

-- One row per sitting: a session id from the game, its first day, its first
-- and last event, and the time on screen the game reported.
CREATE TABLE IF NOT EXISTS va_session (
  game      TEXT    NOT NULL,
  install   TEXT    NOT NULL,
  session   TEXT    NOT NULL,
  day       INTEGER NOT NULL,             -- the game day it started on
  start_ms  INTEGER,
  end_ms    INTEGER,
  events    INTEGER NOT NULL,
  seconds   INTEGER NOT NULL,             -- sum of engagement_time_msec
  cause     TEXT,                         -- app_open's cause, when the sitting began with one
  tz_offset INTEGER,                      -- minutes east of UTC, from app_open, for the heatmap
  build     TEXT,
  PRIMARY KEY (game, install, session)
);
CREATE INDEX IF NOT EXISTS va_session_day ON va_session (game, day);

-- One row per player per day: the table retention and engagement are read from.
CREATE TABLE IF NOT EXISTS va_daily_user (
  game       TEXT    NOT NULL,
  install    TEXT    NOT NULL,
  day        INTEGER NOT NULL,
  platform   TEXT,
  build      TEXT,
  vc         INTEGER,
  country    TEXT,
  events     INTEGER NOT NULL,
  sessions   INTEGER NOT NULL,
  seconds    INTEGER NOT NULL,
  wins       INTEGER NOT NULL DEFAULT 0,  -- Loom: days solved; a level game: levels won
  losses     INTEGER NOT NULL DEFAULT 0,  -- Loom: days failed; a level game: levels lost
  left_      INTEGER NOT NULL DEFAULT 0,  -- Loom: days started and left unfinished
  hints      INTEGER NOT NULL DEFAULT 0,
  ads        INTEGER NOT NULL DEFAULT 0,  -- rewarded adverts watched to the end
  ad_micros  INTEGER NOT NULL DEFAULT 0,  -- what adverts earned (ad_paid), micros
  rev_micros INTEGER NOT NULL DEFAULT 0,  -- verified purchases that day, micros
  streak     INTEGER,
  payer      INTEGER,
  PRIMARY KEY (game, install, day)
);
CREATE INDEX IF NOT EXISTS va_daily_user_day ON va_daily_user (game, day);

-- Loom: the last word on each day and loom a player touched (solved or failed
-- beats left; the later of two beats the earlier).
CREATE TABLE IF NOT EXISTS va_day_result (
  game    TEXT    NOT NULL,
  install TEXT    NOT NULL,
  puzzle  INTEGER NOT NULL,               -- the day's number: an Archive day keeps its own
  loom    TEXT    NOT NULL,               -- 'e', 'n', 'h', or '' before the looms
  played  INTEGER NOT NULL,               -- the day it was played on
  result  TEXT    NOT NULL,               -- solved, failed, left
  tries   INTEGER,
  seconds INTEGER,
  hints   INTEGER,
  archive INTEGER,
  PRIMARY KEY (game, install, puzzle, loom)
);
CREATE INDEX IF NOT EXISTS va_day_result_played ON va_day_result (game, played);

-- Every event counted per day, and split by the few parameters the pages
-- chart (placement, cause, step, loom, result, ...). dim '' is the total.
CREATE TABLE IF NOT EXISTS va_event_day (
  game    TEXT    NOT NULL,
  day     INTEGER NOT NULL,
  build   TEXT    NOT NULL,
  name    TEXT    NOT NULL,
  dim     TEXT    NOT NULL,
  value   TEXT    NOT NULL,
  events  INTEGER NOT NULL,
  players INTEGER NOT NULL,
  PRIMARY KEY (game, day, build, name, dim, value)
);
