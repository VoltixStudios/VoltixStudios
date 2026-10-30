#!/usr/bin/env bash
# Runs Voltix Analytics' collector, deletion and login against a real (local)
# D1 and checks what they answer and what they store.
#
#   bash functions/va/test.sh
#
# Needs network the first time, because it fetches wrangler, and node, python3
# and openssl. Nothing here touches the account: wrangler runs the Functions
# locally against a SQLite file in a temporary directory, deleted at the end.
# The secrets and the licence key are made up for the run.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/functions" "$WORK/tools"
cp -r "$SITE/functions/_va" "$SITE/functions/collect" "$SITE/functions/va" "$WORK/functions/"
cp -r "$SITE/va" "$WORK/"
cp "$SITE/tools/va-secrets.mjs" "$WORK/tools/"
mkdir -p "$WORK/workers/va-nightly/src"
cp "$SITE/workers/va-nightly/src/index.js" "$WORK/workers/va-nightly/src/"   # the Refresh now button runs the same summary
echo "ok" > "$WORK/index.html"
cat > "$WORK/wrangler.jsonc" <<'JSON'
{
  "name": "va-test",
  "compatibility_date": "2026-09-01",
  "pages_build_output_dir": ".",
  "d1_databases": [{ "binding": "VA", "database_name": "va", "database_id": "00000000-0000-0000-0000-000000000000" }]
}
JSON

cd "$WORK" || exit 1
PASSWORD='a test password that is long'
SECRETS=$(VA_PASSWORD="$PASSWORD" node tools/va-secrets.mjs)
jget () { python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$1" "$2"; }
SEED=$(jget "$SECRETS" VA_TOTP_SEED)
CKEY=$(jget "$SECRETS" VA_COOKIE_KEY)

# A licence key pair for the run, so a purchase can be signed the way Play signs one.
openssl genrsa -out lic.pem 2048 2>/dev/null
LIC=$(openssl rsa -in lic.pem -pubout -outform DER 2>/dev/null | base64 -w0)
{
  echo "VA_PASS_HASH=\"$(jget "$SECRETS" VA_PASS_HASH)\""
  echo "VA_TOTP_SEED=\"$SEED\""
  echo "VA_COOKIE_KEY=\"$CKEY\""
  echo "VA_LICENCE_LOOM=\"$LIC\""
} > .dev.vars

npx --yes wrangler d1 execute va --local --file functions/va/schema.sql >/dev/null 2>&1
PORT=$(( 8800 + RANDOM % 900 ))
# Its own process group, so the end of the run stops workerd too and not only
# the npx wrapper (a plain kill leaves the server running in the background).
setsid npx --yes wrangler pages dev . --port "$PORT" > dev.log 2>&1 &
DEV=$!
trap 'kill -9 -- -$DEV 2>/dev/null; rm -rf "$WORK"' EXIT
U="http://localhost:$PORT"
for _ in $(seq 1 60); do
  curl -s -o /dev/null -w '%{http_code}' -X POST "$U/collect" -d '{}' | grep -q 400 && break
  sleep 1
done

# The database file is the one holding the schema; wrangler keeps others beside it.
DB=$(python3 -c '
import glob, sqlite3, sys
for f in glob.glob(".wrangler/**/*.sqlite", recursive=True):
    try:
        if sqlite3.connect(f).execute("SELECT 1 FROM sqlite_master WHERE name=\"va_batch\"").fetchone(): print(f); break
    except Exception: pass')
sql () { python3 -c 'import sqlite3,sys; r=sqlite3.connect(sys.argv[1]).execute(sys.argv[2]).fetchall(); print("|".join(str(c) for row in r for c in row))' "$DB" "$1"; }
post () { curl -s -X POST "$U$1" -H 'Content-Type: application/json' --data-binary "$2"; }
code () { curl -s -o /dev/null -w '%{http_code}' -X POST "$U$1" -H 'Content-Type: application/json' --data-binary "$2"; }
pass=0; fail=0
is () {  # is <label> <got> <want>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  ok    %s\n' "$1"
  else fail=$((fail+1)); printf '  FAIL  %s\n          got  %s\n          want %s\n' "$1" "$2" "$3"; fi
}
NOW=$(( $(date +%s) * 1000 ))
DAY=$(( ($(date -u +%s) - $(date -u -d 2026-01-01 +%s)) / 86400 ))
ID=11111111-2222-3333-4444-555555555555

echo "The collector"
pre=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$U/collect" -H 'Origin: null' \
      -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type')
is "the preflight a WebView sends is answered"             "$pre" "204"
is "a GET is refused"                                       "$(curl -s -o /dev/null -w '%{http_code}' "$U/collect")" "405"

GOOD="{\"v\":1,\"g\":\"loom\",\"i\":\"$ID\",\"p\":\"app\",\"vc\":29,\"fd\":$DAY,
  \"src\":{\"source\":\"google-play\",\"medium\":\"organic\"},
  \"dev\":{\"model\":\"SM-A336B\",\"os\":\"14\",\"webview\":\"130.0\",\"lang\":\"es\",\"screen\":\"1080x2400\"},
  \"e\":[{\"n\":\"app_open\",\"t\":$NOW,\"s\":\"1730000000\",\"q\":1,\"d\":$DAY,\"x\":{\"cause\":\"launcher\",\"cold\":true},\"u\":{\"streak\":3,\"secret\":\"no\"}},
         {\"n\":\"puzzle_solved\",\"t\":$NOW,\"s\":\"1730000000\",\"q\":2,\"d\":$DAY,\"x\":{\"tries\":2,\"seconds\":95,\"nested\":{\"a\":1}}},
         {\"n\":\"made_up_event\",\"t\":$NOW}]}"
is "a good batch keeps two events and refuses the unknown one" "$(post /collect "$GOOD")" '{"ok":true,"kept":2,"refused":1,"purchases":0}'
is "it is one row, holding both events"                    "$(sql "SELECT n, refused FROM va_batch")" "2|1"
is "the install is recorded with its source and phone"     "$(sql "SELECT platform, first_day, vc_first, src_source, dev_model, dev_lang FROM va_install")" "app|$DAY|29|google-play|SM-A336B|es"
is "a user property not on the game's list is dropped"     "$(sql "SELECT events LIKE '%secret%' FROM va_batch")" "0"
is "a param that is not a plain value is dropped"          "$(sql "SELECT events LIKE '%nested%' FROM va_batch")" "0"
is "true is stored as 1"                                    "$(sql "SELECT json_extract(events, '\$[0].x.cold') FROM va_batch")" "1"
is "no address is stored anywhere"                          "$(sql "SELECT COUNT(*) FROM va_batch WHERE events LIKE '%127.0.0.1%'")" "0"

MANY=$(python3 -c 'import json; print(json.dumps({"v":1,"g":"loom","i":"'$ID'","p":"app","e":[{"n":"puzzle_started","x":{"k%d"%i:i for i in range(40)}}]}))')
post /collect "$MANY" >/dev/null
is "an event keeps at most 25 params"                       "$(sql "SELECT (SELECT COUNT(*) FROM json_each(json_extract(events, '\$[0].x'))) FROM va_batch ORDER BY id DESC LIMIT 1")" "25"
OLD="{\"v\":1,\"g\":\"loom\",\"i\":\"$ID\",\"p\":\"app\",\"e\":[{\"n\":\"puzzle_started\",\"t\":1000,\"d\":3}]}"
post /collect "$OLD" >/dev/null
is "a client time and day from long ago are dropped, the event kept" "$(sql "SELECT json_extract(events, '\$[0].t') IS NULL AND json_extract(events, '\$[0].d') IS NULL FROM va_batch ORDER BY id DESC LIMIT 1")" "1"

is "an unknown game is refused"                             "$(code /collect "{\"v\":1,\"g\":\"pong\",\"i\":\"$ID\",\"p\":\"app\",\"e\":[]}")" "400"
is "an install id that is not one is refused"               "$(code /collect '{"v":1,"g":"loom","i":"x","p":"app","e":[]}')" "400"
is "a platform that is not app or web is refused"           "$(code /collect "{\"v\":1,\"g\":\"loom\",\"i\":\"$ID\",\"p\":\"ios\",\"e\":[]}")" "400"
is "a batch of 51 events is refused"                        "$(code /collect "$(python3 -c 'import json; print(json.dumps({"v":1,"g":"loom","i":"'$ID'","p":"app","e":[{"n":"app_open"}]*51}))')")" "400"
is "a body over 64 KB is refused"                           "$(code /collect "$(python3 -c 'print("{\"pad\":\"" + "x"*70000 + "\"}")')")" "400"
is "a body that is not JSON is refused"                     "$(code /collect 'not json')" "400"
is "a batch from an old protocol is refused"                "$(code /collect "{\"v\":2,\"g\":\"loom\",\"i\":\"$ID\",\"p\":\"app\",\"e\":[]}")" "400"
is "the game's own HTML cannot be smuggled in as an event"  "$(post /collect "{\"v\":1,\"g\":\"loom\",\"i\":\"$ID\",\"p\":\"app\",\"e\":[{\"n\":\"<script>\"}]}")" '{"ok":true,"kept":0,"refused":1,"purchases":0}'

pj () { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }
OTHER=22222222-3333-4444-5555-666666666666
is "AshenRise's events are accepted under sombra"          "$(post /collect "{\"v\":1,\"g\":\"sombra\",\"i\":\"$OTHER\",\"p\":\"app\",\"e\":[{\"n\":\"level_end\",\"x\":{\"level_name\":\"1-5\",\"success\":true}},{\"n\":\"puzzle_solved\"}]}")" '{"ok":true,"kept":1,"refused":1,"purchases":0}'
is "Pocket Foundry's events are accepted"                   "$(post /collect "{\"v\":1,\"g\":\"pocketfoundry\",\"i\":\"$OTHER\",\"p\":\"app\",\"e\":[{\"n\":\"order_run\"},{\"n\":\"level_end\"}]}")" '{"ok":true,"kept":2,"refused":0,"purchases":0}'
is "ad_impression, which GA4 reserves, is not a Loom event"  "$(post /collect "{\"v\":1,\"g\":\"loom\",\"i\":\"$OTHER\",\"p\":\"app\",\"e\":[{\"n\":\"ad_impression\"},{\"n\":\"ad_paid\"}]}")" '{"ok":true,"kept":1,"refused":1,"purchases":0}'
is "a game without its licence key yet never verifies a purchase" "$(post /collect "{\"v\":1,\"g\":\"sombra\",\"i\":\"$OTHER\",\"p\":\"app\",\"e\":[],\"pur\":[{\"data\":$(pj '{"orderId":"GPA.0000-1111-2222-33333","packageName":"com.voltixstudios.ashenrise","productId":"sombra_gems_100","purchaseToken":"t9"}'),\"sig\":\"AAAA\",\"price_micros\":990000,\"currency\":\"EUR\"}]}" >/dev/null; sql "SELECT verified FROM va_purchase WHERE id = 'GPA.0000-1111-2222-33333'")" "0"

echo "Purchases"
signed () {  # signed <json> -> the base64 signature, as Play makes it
  printf '%s' "$1" | openssl dgst -sha1 -sign lic.pem | base64 -w0
}
P1='{"orderId":"GPA.1111-2222-3333-44444","packageName":"com.voltixstudios.loom","productId":"loom_full","purchaseTime":'$NOW',"purchaseToken":"tok1"}'
P2='{"orderId":"GPA.5555-6666-7777-88888","packageName":"com.voltixstudios.loom","productId":"loom_full","purchaseTime":'$NOW',"purchaseToken":"tok2"}'
P3='{"orderId":"GPA.9999-0000-1111-22222","packageName":"com.someone.else","productId":"loom_full","purchaseTime":'$NOW',"purchaseToken":"tok3"}'
BUY="{\"v\":1,\"g\":\"loom\",\"i\":\"$ID\",\"p\":\"app\",\"e\":[{\"n\":\"purchase_completed\"}],\"pur\":[
  {\"data\":$(pj "$P1"),\"sig\":\"$(signed "$P1")\",\"price_micros\":2990000,\"currency\":\"EUR\"},
  {\"data\":$(pj "$P2"),\"sig\":\"$(signed "$P1")\",\"price_micros\":2990000,\"currency\":\"EUR\"},
  {\"data\":$(pj "$P3"),\"sig\":\"$(signed "$P3")\",\"price_micros\":2990000,\"currency\":\"EUR\"}]}"
is "three purchases are recorded"                           "$(post /collect "$BUY")" '{"ok":true,"kept":1,"refused":0,"purchases":3}'
is "the one Google signed is verified, with its price"      "$(sql "SELECT verified, sku, price_micros, currency FROM va_purchase WHERE id = 'GPA.1111-2222-3333-44444'")" "1|loom_full|2990000|EUR"
is "one whose signature is not its own is not"              "$(sql "SELECT verified FROM va_purchase WHERE id = 'GPA.5555-6666-7777-88888'")" "0"
is "one signed for another app is not"                      "$(sql "SELECT verified FROM va_purchase WHERE id = 'GPA.9999-0000-1111-22222'")" "0"
is "the purchase token is never stored"                     "$(sql "SELECT COUNT(*) FROM va_purchase WHERE id LIKE '%tok%' OR sku LIKE '%tok%'")" "0"
post /collect "$BUY" >/dev/null
is "the same order sent twice is one row"                   "$(sql "SELECT COUNT(*) FROM va_purchase WHERE game = 'loom'")" "3"

echo "The daily cap"
CAPID=99999999-8888-7777-6666-555555555555
FIFTY=$(python3 -c 'import json; print(json.dumps({"v":1,"g":"loom","i":"'$CAPID'","p":"app","e":[{"n":"weave_submitted"}]*50}))')
last=""
for _ in $(seq 1 60); do last=$(code /collect "$FIFTY"); done
is "3000 events in a day from one install are accepted"     "$last" "200"
is "the next batch that day is refused"                     "$(code /collect "$FIFTY")" "429"
is "and another install is not affected"                    "$(code /collect "${FIFTY//$CAPID/aaaaaaaa-8888-7777-6666-555555555555}")" "200"

echo "Deletion"
is "a deletion for an install id that is not one is refused" "$(code /collect/delete '{"g":"loom","i":"x"}')" "400"
del=$(post /collect/delete "{\"g\":\"loom\",\"i\":\"$ID\"}")
is "a player's deletion is accepted"                        "$(echo "$del" | grep -o '"ok":true')" '"ok":true'
is "and every row of theirs is gone"                        "$(sql "SELECT (SELECT COUNT(*) FROM va_batch WHERE install='$ID') + (SELECT COUNT(*) FROM va_install WHERE install='$ID') + (SELECT COUNT(*) FROM va_purchase WHERE install='$ID')")" "0"
is "another player's rows are untouched"                    "$(sql "SELECT COUNT(*) > 0 FROM va_batch WHERE install='$CAPID'")" "1"
is "what is kept is a count, not whose"                     "$(sql "SELECT n FROM va_deleted")" "1"

echo "The lock on /va/"
hdr () { curl -s -D - -o /dev/null "$@" | tr -d '\r' | tr 'A-Z' 'a-z'; }
is "the dashboard without a login sends to the login"       "$(hdr "$U/va/" | grep -o '^location: /va/login')" "location: /va/login"
is "the API without a login answers 401"                    "$(curl -s -o /dev/null -w '%{http_code}' "$U/va/api/ping")" "401"
is "and still carries no-framing"                           "$(hdr "$U/va/api/ping" | grep -o '^x-frame-options: deny')" "x-frame-options: deny"
is "the login page is served"                               "$(curl -s "$U/va/login" | grep -o 'name="code"' | head -1)" 'name="code"'
is "the login page cannot be framed or indexed"             "$(hdr "$U/va/login" | grep -cE '^(x-frame-options: deny|x-robots-tag: noindex|content-security-policy: .*frame-ancestors .none.)')" "3"
login () { curl -s -o /dev/null -D - -w '%{http_code}' -X POST "$U/va/login" --data-urlencode "password=$1" --data-urlencode "code=$2" | tr -d '\r'; }
is "a wrong password is refused"                            "$(login 'wrong password here' "$(node tools/va-secrets.mjs --code "$SEED")" | tail -1)" "401"
is "the right password with a wrong code is refused"        "$(login "$PASSWORD" 000000 | tail -1)" "401"
CODE=$(node tools/va-secrets.mjs --code "$SEED")
ok=$(login "$PASSWORD" "$CODE")
is "the right password and code sign in"                    "$(echo "$ok" | tail -1)" "303"
COOKIE=$(echo "$ok" | grep -i '^set-cookie:' | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+).*/\1/')
is "with a cookie that is HttpOnly, Secure and SameSite=Strict" "$(echo "$ok" | grep -i '^set-cookie:' | grep -c 'HttpOnly' )$(echo "$ok" | grep -i '^set-cookie:' | grep -c 'Secure')$(echo "$ok" | grep -i '^set-cookie:' | grep -c 'SameSite=Strict')" "111"
is "the API answers with it"                                "$(curl -s -H "Cookie: $COOKIE" "$U/va/api/ping" | grep -o '"ok":true')" '"ok":true'
is "and the dashboard is served"                            "$(curl -s -H "Cookie: $COOKIE" "$U/va/" | grep -o 'src="/va/app.js"')" 'src="/va/app.js"'
is "its script too, but only with the login"                "$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $COOKIE" "$U/va/app.js")$(curl -s -o /dev/null -w '%{http_code}' "$U/va/app.js")" "200302"
for page in overview acquisition retention engagement progress money health; do
  is "the $page page's data answers"                        "$(curl -s -H "Cookie: $COOKIE" "$U/va/api/$page?game=loom&range=30&build=all" | grep -o '"today":[0-9]*' | head -1 | cut -d: -f1)" '"today"'
done
T0=$(( ($(date -u +%s) - $(date -u -d 2026-01-01 +%s)) / 86400 ))
is "a custom range is honoured"                             "$(curl -s -H "Cookie: $COOKIE" "$U/va/api/overview?game=loom&from=$((T0-10))&to=$((T0-3))" | grep -o '"custom":true,"today":[0-9]*,"from":[0-9]*')" "\"custom\":true,\"today\":$((T0-3)),\"from\":$((T0-10))"
is "a custom range ending in the future falls back"         "$(curl -s -H "Cookie: $COOKIE" "$U/va/api/overview?game=loom&from=$((T0-3))&to=$((T0+5))" | grep -o '"custom":false')" '"custom":false'
# Two games under one install id, so that only the game key can keep them apart (seeded before
# the one Refresh now below, which builds the summaries the pages read).
TD=$(( ($(date -u +%s) - $(date -u -d 2026-01-01 +%s)) / 86400 ))
SAME=12121212-3434-5656-7878-909090909090
post /collect "{\"v\":1,\"g\":\"pocketfoundry\",\"i\":\"$SAME\",\"p\":\"web\",\"e\":[{\"n\":\"app_open\",\"t\":$NOW,\"s\":\"1\",\"d\":$TD,\"x\":{\"build\":\"lab\",\"cause\":\"notification\"}},{\"n\":\"notify_answer\",\"t\":$NOW,\"s\":\"1\",\"d\":$TD,\"x\":{\"build\":\"lab\",\"state\":\"on\"}}]}" >/dev/null
post /collect "{\"v\":1,\"g\":\"loom\",\"i\":\"$SAME\",\"p\":\"app\",\"e\":[{\"n\":\"app_open\",\"t\":$NOW,\"s\":\"2\",\"d\":$TD,\"x\":{\"build\":\"release\",\"cause\":\"launcher\"}}]}" >/dev/null
is "Refresh now without a login is refused"                 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$U/va/api/refresh")" "401"
is "Refresh now from another site is refused"               "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Cookie: $COOKIE" -H 'Origin: https://evil.example' "$U/va/api/refresh")" "403"
is "Refresh now runs the summary"                           "$(curl -s -X POST -H "Cookie: $COOKIE" "$U/va/api/refresh" | grep -o '"ok":true')" '"ok":true'
is "and records it as done by hand"                         "$(sql "SELECT json_extract(v, '\$.source') FROM va_meta WHERE k = 'nightly_last'")" "manual"
is "the pages say when it ran"                              "$(curl -s -H "Cookie: $COOKIE" "$U/va/api/health?game=loom" | grep -o '"summary":{"at"')" '"summary":{"at"'
echo "Games kept apart"
api () { curl -s -H "Cookie: $COOKIE" "$U/va/api/$1"; }
is "one install id in two games is two players, one in each" "$(sql "SELECT group_concat(game || ':' || build, ',') FROM (SELECT game, build FROM va_daily_user WHERE install = '$SAME' ORDER BY game)")" "loom:release,pocketfoundry:lab"
is "the lab is a build of its own on the pages"              "$(api "overview?game=pocketfoundry&build=lab" | grep -o '"build":"lab"')" '"build":"lab"'
is "a game's lab players are not counted as its players"     "$(api "engagement?game=pocketfoundry&build=release" | grep -c 'notify_answer')" "0"
is "its reminder answers are its own"                         "$(api "engagement?game=pocketfoundry&build=lab" | grep -o '"name":"notify_answer","value":"on","events":1,"players":1')" '"name":"notify_answer","value":"on","events":1,"players":1'
is "and never another game's"                                 "$(api "engagement?game=loom&build=all" | grep -c 'notify_answer\|notification')" "0"
is "Health counts only the chosen game's batches"             "$(api "health?game=pocketfoundry&build=all" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(r["batches"] for r in d["intake"]))')" "$(sql "SELECT COUNT(*) FROM va_batch WHERE game = 'pocketfoundry'")"
is "a second refresh within ten minutes is refused"         "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Cookie: $COOKIE" "$U/va/api/refresh")" "429"
is "an unknown page is refused"                             "$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $COOKIE" "$U/va/api/nothing")" "404"
is "a game, range or build not on the lists falls back"     "$(curl -s -H "Cookie: $COOKIE" "$U/va/api/overview?game=x%27;DROP&range=999&build=evil" | grep -o '"game":"loom","range":30,"build":"release"')" '"game":"loom","range":30,"build":"release"'
is "the same code cannot sign in twice"                     "$(login "$PASSWORD" "$CODE" | tail -1)" "401"
FORGED="${COOKIE%?}A"; [ "$FORGED" = "$COOKIE" ] && FORGED="${COOKIE%?}B"
is "a cookie with a changed signature is refused"           "$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $FORGED" "$U/va/api/ping")" "401"
EXPIRED=$(node -e '
  const c=require("node:crypto"); const exp=Date.now()-1000; const n="AAAAAAAAAAAAAAAA";
  const s=c.createHmac("sha256",process.argv[1]).update("va1."+exp+"."+n).digest("base64url");
  console.log("__Host-va="+exp+"."+n+"."+s)' "$CKEY")
is "a correctly signed cookie that has expired is refused"  "$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $EXPIRED" "$U/va/api/ping")" "401"
FAR=$(node -e '
  const c=require("node:crypto"); const exp=Date.now()+30*86400000; const n="AAAAAAAAAAAAAAAA";
  const s=c.createHmac("sha256",process.argv[1]).update("va1."+exp+"."+n).digest("base64url");
  console.log("__Host-va="+exp+"."+n+"."+s)' "$CKEY")
is "one claiming to last a month is refused"                "$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: $FAR" "$U/va/api/ping")" "401"
login "$PASSWORD" 111111 >/dev/null
login "$PASSWORD" 222222 >/dev/null
is "after five failures the login is locked"                "$(login "$PASSWORD" "$(node tools/va-secrets.mjs --code "$SEED")" | tail -1)" "429"
is "every attempt was recorded, never the address"          "$(sql "SELECT COUNT(*), SUM(who LIKE '%127%') FROM va_login")" "6|0"
out=$(curl -s -D - -o /dev/null -X POST -H "Cookie: $COOKIE" "$U/va/logout" | tr -d '\r')
is "signing out clears the cookie"                          "$(echo "$out" | grep -io 'max-age=0')" "Max-Age=0"

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ] || { echo "--- wrangler log ---"; tail -30 dev.log; exit 1; }
