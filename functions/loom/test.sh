#!/usr/bin/env bash
# Runs /loom/scores against a real (local) D1 and checks what it answers.
#
#   bash functions/loom/test.sh
#
# Needs network the first time, because it fetches wrangler. Nothing here
# touches the account: wrangler runs the function locally against a SQLite file
# in a temporary directory, which is deleted at the end.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/functions/loom"
cp "$HERE/scores.js" "$HERE/schema.sql" "$WORK/functions/loom/"
echo "ok" > "$WORK/index.html"
cat > "$WORK/wrangler.jsonc" <<'JSON'
{
  "name": "loom-scores-test",
  "compatibility_date": "2026-09-01",
  "pages_build_output_dir": ".",
  "d1_databases": [{ "binding": "LOOM", "database_name": "loom", "database_id": "00000000-0000-0000-0000-000000000000" }]
}
JSON

cd "$WORK" || exit 1
npx --yes wrangler d1 execute loom --local --file functions/loom/schema.sql >/dev/null 2>&1
PORT=$(( 8800 + RANDOM % 900 ))
npx --yes wrangler pages dev . --port "$PORT" > dev.log 2>&1 &
DEV=$!
trap 'kill $DEV 2>/dev/null; rm -rf "$WORK"' EXIT
DAY=$(( ($(date -u +%s) - $(date -u -d 2026-01-01 +%s)) / 86400 ))
# Wait for the function itself, not merely for a socket: a page can answer
# while the D1 binding is still coming up, and the first result would be lost.
for _ in $(seq 1 60); do
  curl -s "http://localhost:$PORT/loom/scores?d=$DAY" | grep -q '"solved"' && break
  sleep 1
done
post () { curl -s -X POST "localhost:$PORT/loom/scores" -H 'Content-Type: application/json' -d "$1"; }
pass=0; fail=0
is () {  # is <label> <got> <want>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  ok    %s\n' "$1"
  else fail=$((fail+1)); printf '  FAIL  %s\n          got  %s\n          want %s\n' "$1" "$2" "$3"; fi
}

# The preflight first, because the game cannot reach anything below it without
# one. It is a POST from a file:// WebView carrying a JSON content type, so the
# browser asks before it sends, and for a long time this answered 500.
pre=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "localhost:$PORT/loom/scores" \
      -H 'Origin: null' -H 'Access-Control-Request-Method: POST' \
      -H 'Access-Control-Request-Headers: content-type')
is "the preflight a WebView sends is answered"        "$pre" "204"
allow=$(curl -s -D - -o /dev/null -X OPTIONS "localhost:$PORT/loom/scores" \
        -H 'Origin: null' -H 'Access-Control-Request-Method: POST' \
        -H 'Access-Control-Request-Headers: content-type' \
        | grep -io 'access-control-allow-origin: \*' | tr -d '\r' | tr 'A-Z' 'a-z')
is "and it allows the null origin the game has"       "$allow" "access-control-allow-origin: *"

first=$(post "{\"d\":$DAY,\"a\":3,\"s\":95,\"k\":\"aaaaaaaaaaaaaaaa\"}")
is "a solved day is counted, and is the first"        "$(echo "$first" | grep -o '"rank":1')" '"rank":1'
again=$(post "{\"d\":$DAY,\"a\":3,\"s\":95,\"k\":\"aaaaaaaaaaaaaaaa\"}")
is "the same phone twice counts once"                 "$(echo "$again" | grep -o '"n":1')" '"n":1'
second=$(post "{\"d\":$DAY,\"a\":1,\"s\":25,\"k\":\"bbbbbbbbbbbbbbbb\"}")
is "another phone is the second to solve it"          "$(echo "$second" | grep -o '"rank":2')" '"rank":2'
lost=$(post "{\"d\":$DAY,\"a\":0,\"k\":\"cccccccccccccccc\"}")
is "a day that was lost is counted as lost"           "$(echo "$lost" | grep -o '"lost":1')" '"lost":1'
is "and is given no rank"                             "$(echo "$lost" | grep -c 'rank')" "0"
read=$(curl -s "localhost:$PORT/loom/scores?d=$DAY")
is "the day reads back the same"                      "$(echo "$read" | grep -o '"solved":\[1,0,1,0,0,0\]')" '"solved":[1,0,1,0,0,0]'
is "a day that is not this one is refused"            "$(post "{\"d\":99999,\"a\":3,\"k\":\"dddddddddddddddd\"}")" '{"error":"day"}'
is "seven attempts out of six is refused"             "$(post "{\"d\":$DAY,\"a\":9,\"k\":\"dddddddddddddddd\"}")" '{"error":"attempts"}'
is "a result with nothing to deduplicate is refused"  "$(post "{\"d\":$DAY,\"a\":2}")" '{"error":"key"}'
is "a time nobody could have taken is not banded"     "$(post "{\"d\":$DAY,\"a\":2,\"s\":99999,\"k\":\"eeeeeeeeeeeeeeee\"}" | grep -o '"t":\[1,0,1,0,0,0\]')" '"t":[1,0,1,0,0,0]'

echo
if [ $fail -eq 0 ]; then echo "$pass checks passed."; else echo "$pass passed, $fail FAILED."; fi
exit $([ $fail -eq 0 ] && echo 0 || echo 1)
