#!/usr/bin/env bash
# Runs the nightly summaries against a real (local) D1 seeded with known
# players, and checks every table it writes.
#
#   bash workers/va-nightly/test.sh
#
# Needs network the first time (wrangler), and python3. Nothing touches the
# account: wrangler runs the Worker locally, fires its cron through
# /__scheduled, and the SQLite file lives in a temporary directory.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/src"
cp "$HERE/src/index.js" "$WORK/src/"
cp "$SITE/functions/va/schema.sql" "$WORK/"
cat > "$WORK/wrangler.jsonc" <<'JSON'
{
  "name": "va-nightly-test",
  "main": "src/index.js",
  "compatibility_date": "2026-09-01",
  "triggers": { "crons": ["10 2 * * *"] },
  "d1_databases": [{ "binding": "VA", "database_name": "va", "database_id": "00000000-0000-0000-0000-000000000000" }]
}
JSON
cd "$WORK" || exit 1
npx --yes wrangler d1 execute va --local --file schema.sql >/dev/null 2>&1
DB=$(python3 -c '
import glob, sqlite3
for f in glob.glob(".wrangler/**/*.sqlite", recursive=True):
    try:
        if sqlite3.connect(f).execute("SELECT 1 FROM sqlite_master WHERE name=\"va_batch\"").fetchone(): print(f); break
    except Exception: pass')

# The seed. T is today; days are counted as the Worker counts them.
#   A  loom, first day T-10; plays T-10, T-9, T-3 (left, then solved) and T
#   B  loom, first day T-2; plays T-2, starts and leaves
#   C  loom, a debug build, today
#   S  sombra, today: one level won, one lost
# plus a batch from 95 days ago, which the nightly must delete.
python3 - "$DB" <<'PY'
import json, sqlite3, sys, time
DAY0 = 1767225600000                                   # 2026-01-01 UTC, ms
now = int(time.time() * 1000)
T = (now - DAY0) // 86400000
c = sqlite3.connect(sys.argv[1])
def ms(d, h=10): return DAY0 + d * 86400000 + h * 3600000
def batch(game, install, day, events, build="release", platform="app", country="ES", vc=29):
    for e in events:
        e.setdefault("x", {})["build"] = build
    c.execute("INSERT INTO va_batch (game, install, platform, vc, day, received, country, n, refused, events) VALUES (?,?,?,?,?,?,?,?,0,?)",
              (game, install, platform, vc, day, ms(day, 12), country, len(events), json.dumps(events)))
def ev(n, d, s, x=None, h=10, u=None):
    return {"n": n, "t": ms(d, h), "s": str(s), "d": d, "x": dict(x or {}), "u": u or {"streak": 1, "payer": 0}}
A, B, C, S = "aaaaaaaa-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002", "cccccccc-0000-0000-0000-000000000003", "ssssssss-0000-0000-0000-000000000004"
for d in (T - 10, T - 9):
    batch("loom", A, d, [ev("app_open", d, d, {"cause": "launcher", "cold": 1, "first": int(d == T - 10), "tz_offset": 60, "engagement_time_msec": 1}),
                         ev("day_result", d, d, {"day_number": d, "loom": "n", "result": "solved", "tries": 2, "seconds": 80, "hints": 0, "engagement_time_msec": 90000})])
d = T - 3
batch("loom", A, d, [ev("app_open", d, 1000, {"cause": "reminder", "cold": 1, "first": 0, "tz_offset": 60, "engagement_time_msec": 1}, h=8),
                     ev("day_result", d, 1000, {"day_number": d, "loom": "h", "result": "left", "tries": 1, "seconds": 40, "engagement_time_msec": 40000}, h=8)])
batch("loom", A, d + 1, [ev("day_result", d, 2000, {"day_number": d, "loom": "h", "result": "solved", "tries": 3, "seconds": 150, "hints": 1, "engagement_time_msec": 120000}, h=21),
                         ev("hint_taken", d, 2000, {"day_number": d, "source": "free", "engagement_time_msec": 1000}, h=21)])
batch("loom", A, T, [ev("app_open", T, 3000, {"cause": "launcher", "cold": 1, "first": 0, "tz_offset": 60, "engagement_time_msec": 1}, h=7),
                     ev("rewarded_ad_offered", T, 3000, {"placement": "cloth", "engagement_time_msec": 1000}, h=7),
                     ev("rewarded_ad_completed", T, 3000, {"placement": "cloth", "engagement_time_msec": 30000}, h=7),
                     ev("ad_paid", T, 3000, {"placement": "cloth", "ad_format": "rewarded", "value": 0.0125, "currency": "EUR", "engagement_time_msec": 1}, h=7),
                     ev("day_result", T, 3000, {"day_number": T, "loom": "n", "result": "failed", "tries": 4, "seconds": 200, "engagement_time_msec": 60000}, h=7)])
c.execute("INSERT INTO va_purchase (id, game, install, sku, price_micros, currency, purchase_time, verified, received) VALUES ('GPA.1','loom',?, 'loom_hints_10', 990000, 'EUR', ?, 1, ?)", (A, ms(T, 7), ms(T, 7)))
c.execute("INSERT INTO va_purchase (id, game, install, sku, price_micros, currency, purchase_time, verified, received) VALUES ('GPA.2','loom',?, 'loom_hints_10', 990000, 'EUR', ?, 0, ?)", (A, ms(T, 7), ms(T, 7)))
d = T - 2
batch("loom", B, d, [ev("app_open", d, 4000, {"cause": "launcher", "cold": 1, "first": 1, "engagement_time_msec": 1}),
                     ev("first_session_step", d, 4000, {"step": "intro", "engagement_time_msec": 1}),
                     ev("day_result", d, 4000, {"day_number": d, "loom": "e", "result": "left", "tries": 1, "seconds": 30, "engagement_time_msec": 30000})], country="MX")
batch("loom", C, T, [ev("app_open", T, 5000, {"cause": "launcher", "cold": 1, "first": 1, "engagement_time_msec": 1})], build="debug")
batch("sombra", S, T, [ev("level_end", T, 6000, {"level_name": "1-1", "success": 1, "engagement_time_msec": 100000}),
                       ev("level_end", T, 6000, {"level_name": "1-2", "success": 0, "left": 0, "engagement_time_msec": 80000})])
batch("loom", A, T - 95, [ev("app_open", T - 95, 9, {"cause": "launcher", "engagement_time_msec": 1})])
c.commit()
print(T)
PY

PORT=$(( 8800 + RANDOM % 900 ))
start () {   # start <backfill days or empty>; a fresh port each time, so a stale process cannot answer
  PORT=$((PORT + 1))
  [ -n "$1" ] && echo "VA_BACKFILL_DAYS=$1" > .dev.vars || rm -f .dev.vars
  setsid npx --yes wrangler dev --test-scheduled --port "$PORT" > dev.log 2>&1 &
  DEV=$!
  for _ in $(seq 1 60); do curl -s -o /dev/null "localhost:$PORT/__scheduled" && break; sleep 1; done
}
stop () { kill -9 -- -$DEV 2>/dev/null; wait $DEV 2>/dev/null; sleep 1; }   # the whole group: npx, wrangler and workerd
fire () {    # fires the cron and waits for va_meta to say it ran
  local before; before=$(sql "SELECT v FROM va_meta WHERE k='nightly_last'")
  curl -s "localhost:$PORT/__scheduled?cron=10+2+*+*+*" >/dev/null
  for _ in $(seq 1 60); do [ "$(sql "SELECT v FROM va_meta WHERE k='nightly_last'")" != "$before" ] && return; sleep 0.5; done
}
sql () { python3 -c 'import sqlite3,sys; r=sqlite3.connect(sys.argv[1]).execute(sys.argv[2]).fetchall(); print("|".join(str(c) for row in r for c in row))' "$DB" "$1"; }
trap 'stop; rm -rf "$WORK"' EXIT
pass=0; fail=0
is () {
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  ok    %s\n' "$1"
  else fail=$((fail+1)); printf '  FAIL  %s\n          got  %s\n          want %s\n' "$1" "$2" "$3"; fi
}
A=aaaaaaaa-0000-0000-0000-000000000001; B=bbbbbbbb-0000-0000-0000-000000000002
T=$(python3 -c 'import time; print((int(time.time()*1000) - 1767225600000) // 86400000)')

start 20
fire
echo "One row per player per day"
is "A played on four days"                          "$(sql "SELECT COUNT(*) FROM va_daily_user WHERE install='$A'")" "4"
is "B on one, from Mexico"                          "$(sql "SELECT COUNT(*), MAX(country) FROM va_daily_user WHERE install='$B'")" "1|MX"
is "time on screen is the game's own, in seconds"   "$(sql "SELECT seconds FROM va_daily_user WHERE install='$A' AND day=$T-10")" "90"
is "a day played across two sittings is one day"    "$(sql "SELECT sessions, wins, left_, hints FROM va_daily_user WHERE install='$A' AND day=$T-3")" "2|1|1|1"
is "today: a loss, an advert, its earnings"         "$(sql "SELECT losses, ads, ad_micros FROM va_daily_user WHERE install='$A' AND day=$T")" "1|1|12500"
is "revenue counts only what Google signed"         "$(sql "SELECT rev_micros FROM va_daily_user WHERE install='$A' AND day=$T")" "990000"
is "a debug build is kept, and marked"              "$(sql "SELECT build FROM va_daily_user WHERE install LIKE 'cccc%'")" "debug"
is "a level game's wins and losses"                 "$(sql "SELECT wins, losses FROM va_daily_user WHERE game='sombra'")" "1|1"

echo "Sittings"
is "each session id is one sitting"                 "$(sql "SELECT COUNT(*) FROM va_session WHERE install='$A'")" "5"
is "with what opened it and the phone's time zone"  "$(sql "SELECT cause, tz_offset FROM va_session WHERE install='$A' AND session='1000'")" "reminder|60"
is "and its time on screen"                         "$(sql "SELECT seconds FROM va_session WHERE install='$A' AND session='2000'")" "121"

echo "Loom's days"
is "left, then solved later the same day: solved"   "$(sql "SELECT result, tries, hints FROM va_day_result WHERE install='$A' AND puzzle=$T-3")" "solved|3|1"
is "left and never finished stays left"             "$(sql "SELECT result FROM va_day_result WHERE install='$B'")" "left"
is "one row per day and loom"                       "$(sql "SELECT COUNT(*) FROM va_day_result WHERE install='$A'")" "4"

echo "Events per day"
is "every event counted"                            "$(sql "SELECT events, players FROM va_event_day WHERE day=$T AND name='app_open' AND dim='' AND build='release'")" "1|1"
is "debug kept apart"                               "$(sql "SELECT events FROM va_event_day WHERE day=$T AND name='app_open' AND dim='' AND build='debug'")" "1"
is "split by what opened the game"                  "$(sql "SELECT value FROM va_event_day WHERE day=$T-3 AND name='app_open' AND dim='cause'")" "reminder"
is "split by placement"                             "$(sql "SELECT events FROM va_event_day WHERE day=$T AND name='rewarded_ad_completed' AND dim='placement' AND value='cloth'")" "1"
is "split by first-day step"                        "$(sql "SELECT value FROM va_event_day WHERE name='first_session_step' AND dim='step'")" "intro"

echo "Housekeeping"
is "raw batches over 90 days old are deleted"       "$(sql "SELECT COUNT(*) FROM va_batch WHERE day < $T-90")" "0"
is "the run is recorded"                            "$(sql "SELECT json_extract(v,'\$.from') FROM va_meta WHERE k='nightly_last'")" "$((T-20))"
rows=$(sql "SELECT (SELECT COUNT(*) FROM va_daily_user)||'/'||(SELECT COUNT(*) FROM va_session)||'/'||(SELECT COUNT(*) FROM va_day_result)||'/'||(SELECT COUNT(*) FROM va_event_day)")
fire
is "running twice changes nothing"                  "$(sql "SELECT (SELECT COUNT(*) FROM va_daily_user)||'/'||(SELECT COUNT(*) FROM va_session)||'/'||(SELECT COUNT(*) FROM va_day_result)||'/'||(SELECT COUNT(*) FROM va_event_day)")" "$rows"
stop

echo "An ordinary night touches only the last three days and today"
python3 -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.commit()' "$DB" "UPDATE va_daily_user SET seconds = 7 WHERE install='$A' AND day=$T-9"
python3 -c 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.commit()' "$DB" "UPDATE va_daily_user SET seconds = 7 WHERE install='$A' AND day=$T-3"
start ""
fire
is "an older day is left as it was"                 "$(sql "SELECT seconds FROM va_daily_user WHERE install='$A' AND day=$T-9")" "7"
is "a day inside the window is recalculated"        "$(sql "SELECT seconds FROM va_daily_user WHERE install='$A' AND day=$T-3")" "161"
is "and the window is recorded"                     "$(sql "SELECT json_extract(v,'\$.from') FROM va_meta WHERE k='nightly_last'")" "$((T-3))"
stop

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || { echo "--- wrangler log ---"; tail -30 dev.log; exit 1; }
