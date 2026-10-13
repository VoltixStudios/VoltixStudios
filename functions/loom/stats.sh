#!/usr/bin/env bash
# Loom's numbers, read from the live D1. Read-only: it runs SELECTs and nothing
# else, so it is safe to run at any time.
#
#   bash functions/loom/stats.sh          the last 28 days
#   bash functions/loom/stats.sh 60       the last 60
#
# Needs `wrangler login` on this machine. What each column means is printed
# under the tables, because a number read without its definition is how a
# finished-day count gets reported as "players".
set -euo pipefail
DAYS="${1:-28}"
cd "$(dirname "$0")/../.."
SQL="SELECT day, total, lost FROM loom_day;
SELECT day, total, lost FROM loom_fresh;
SELECT first, day, n FROM loom_cohort;"
npx --yes wrangler d1 execute loom --remote --json --command "$SQL" 2>/dev/null \
  | python3 -I -c '
import json, sys, datetime
days = int(sys.argv[1])
sets = [s.get("results", []) for s in json.load(sys.stdin)]
res   = {r["day"]: r for r in sets[0]}
fresh = {r["day"]: r for r in sets[1]}
coh   = {}
for r in sets[2]: coh[(r["first"], r["day"])] = r["n"]
d0 = datetime.date(2026, 1, 1)
date = lambda d: (d0 + datetime.timedelta(days=d)).strftime("%a %d %b")
today = (datetime.datetime.now(datetime.timezone.utc).date() - d0).days
pct = lambda a, b: ("%3d%%" % round(100 * a / b)) if b else "   -"

print("\nDAY BY DAY  (UTC days; today is partial)\n")
print("%-11s %5s %5s %6s %6s %6s %7s %7s %9s" % ("", "open", "new", "fin", "solved", "lost", "solve%", "finish%", "new lost"))
for d in range(today - days + 1, today + 1):
    opens = sum(n for (f, dd), n in coh.items() if dd == d)
    new = coh.get((d, d), 0)
    r = res.get(d, {"total": 0, "lost": 0}); fr = fresh.get(d, {"total": 0, "lost": 0})
    fin, lost = r["total"], r["lost"]
    if not (opens or fin): continue
    print("%-11s %5s %5s %6d %6d %6d %7s %7s %9s" % (
        date(d), opens or "-", new or "-", fin, fin - lost, lost, pct(fin - lost, fin),
        pct(fin, opens) if opens else "   -", ("%d/%d" % (fr["lost"], fr["total"])) if fr["total"] else "-"))

firsts = sorted({f for (f, d) in coh if (f, f) in coh and f > today - days})
if firsts:
    print("\nRETURN BY COHORT  (share of the phones that started that day and opened it again)\n")
    marks = [1, 3, 7, 14, 30]
    print("%-11s %5s " % ("started", "size") + " ".join("%5s" % ("D%d" % m) for m in marks))
    for f in firsts:
        size = coh[(f, f)]
        cells = []
        for m in marks:
            if f + m > today: cells.append("    .")
            else: cells.append("%5s" % pct(coh.get((f, f + m), 0), size).strip())
        print("%-11s %5d " % (date(f), size) + " ".join(cells))
else:
    print("\nRETURN BY COHORT: no opens recorded yet (needs a build that sends them).")

print("""
open      phones that opened today\x27s cloth (analytics on, online at some point)
new       of those, phones opening Loom for the first time
fin       phones that finished the day, solved or lost
solve%    solved / finished
finish%   finished / opened: the rest gave up or have not finished yet
          (over 100% while builds older than versionCode 25, which send no
          opens, are still on phones)
new lost  first-day phones that lost / first-day phones that finished
D1, D7    of a day\x27s new phones, the share that opened Loom 1, 7 days later
          ("." means that day has not come yet)
Not counted anywhere: players with analytics off, the website copy, archive days.""")
' "$DAYS"
