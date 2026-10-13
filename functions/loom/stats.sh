#!/usr/bin/env bash
# Loom's numbers, read from the live D1. Read-only: it runs SELECTs and nothing
# else, so it is safe to run at any time.
#
#   bash functions/loom/stats.sh            the last 28 days
#   bash functions/loom/stats.sh 60         the last 60
#   bash functions/loom/stats.sh 60 45      ... and follow each cohort 45 days
#
# Needs `wrangler login` on this machine. What each column means is printed
# under the tables, because a number read without its definition is how a
# finished-day count gets reported as "players".
set -euo pipefail
DAYS="${1:-28}"
FOLLOW="${2:-30}"
cd "$(dirname "$0")/../.."
SQL="SELECT day, total, lost FROM loom_day;
SELECT day, total, lost FROM loom_fresh;
SELECT first, day, gap, n FROM loom_open;
SELECT day, tier, total, lost, fresh, flost, c1, c2, c3, c4, c5, c6, c7, c8 FROM loom_result;"
npx --yes wrangler d1 execute loom --remote --json --command "$SQL" 2>/dev/null \
  | python3 -I -c '
import json, sys, datetime
days, follow = int(sys.argv[1]), int(sys.argv[2])
sets = [s.get("results", []) for s in json.load(sys.stdin)]
legacy = {r["day"]: r for r in sets[0]}
fresh  = {r["day"]: r for r in sets[1]}
opens  = sets[2]
looms  = {}
for r in sets[3]: looms[(r["day"], r["tier"])] = r
d0 = datetime.date(2026, 1, 1)
date = lambda d: (d0 + datetime.timedelta(days=d)).strftime("%a %d %b")
today = (datetime.datetime.now(datetime.timezone.utc).date() - d0).days
pct = lambda a, b: ("%d%%" % round(100 * a / b)) if b else "-"
since = min([r["day"] for r in opens] or [today])

# A phone is counted once in a run of days [a, b]: on the first day it opened
# inside the run, which is the open whose gap reaches back past a. A first day
# (gap 0) always is; an open that did not say its gap (-1) is counted every
# time, so a run with many of those is a ceiling, and the report says so.
def unique(a, b, first=None):
    return sum(r["n"] for r in opens
               if a <= r["day"] <= b and (first is None or r["first"] == first)
               and (r["gap"] == 0 or r["gap"] == -1 or r["gap"] > r["day"] - a))
def unknown(a, b):
    return sum(r["n"] for r in opens if a <= r["day"] <= b and r["gap"] == -1)
def on(d, **k):
    return sum(r["n"] for r in opens if r["day"] == d and all(r[x] == v for x, v in k.items()))
def gaps(d, lo, hi):
    return sum(r["n"] for r in opens if r["day"] == d and lo <= r["gap"] <= hi)

print("\nPLAYERS  (unique phones; counting began %s)\n" % date(since))
print("%-22s %8s %6s" % ("", "players", "new"))
for label, a in (("today", today), ("last 7 days", today - 6), ("last 30 days", today - 29), ("since counting began", since)):
    a = max(a, since)
    new = sum(r["n"] for r in opens if a <= r["day"] <= today and r["gap"] == 0)
    print("%-22s %8d %6d" % (label, unique(a, today), new))
dau = sum(unique(d, d) for d in range(today - 6, today + 1)) / 7
mau = unique(max(today - 29, since), today)
print("\naverage daily players, last 7 days: %.1f   stickiness (daily / monthly): %s" % (dau, pct(dau, mau)))
if unknown(since, today):
    print("(%d opens from versionCode 25 did not say when they last opened: the runs above count them every day, so they are ceilings)" % unknown(since, today))

print("\nDAY BY DAY  (UTC days; today is partial)\n")
print("%-11s %5s %4s %5s %5s %5s %5s   %4s %6s %5s %7s %7s %8s" % ("", "open", "new", "back1", "back7", "back+", "?", "fin", "solved", "lost", "solve%", "finish%", "new lost"))
for d in range(today - days + 1, today + 1):
    o = on(d)
    lr = [r for (dd, t), r in looms.items() if dd == d]
    lg = legacy.get(d, {"total": 0, "lost": 0})
    fin = lg["total"] + sum(r["total"] for r in lr)
    lost = lg["lost"] + sum(r["lost"] for r in lr)
    fr = fresh.get(d, {"total": 0, "lost": 0})
    nt, nl = fr["total"] + sum(r["fresh"] for r in lr), fr["lost"] + sum(r["flost"] for r in lr)
    if not (o or fin): continue
    print("%-11s %5s %4s %5s %5s %5s %5s   %4d %6d %5d %7s %7s %8s" % (
        date(d), o or "-", on(d, gap=0) or "-", gaps(d, 1, 1) or "-", gaps(d, 2, 7) or "-",
        gaps(d, 8, 999) or "-", on(d, gap=-1) or "-", fin, fin - lost, lost, pct(fin - lost, fin),
        pct(fin, o) if o else "-", ("%d/%d" % (nl, nt)) if nt else "-"))

monday = lambda d: d - (d0 + datetime.timedelta(days=d)).weekday()
weeks = sorted({monday(d) for d in range(max(since, today - days + 1), today + 1)})
if opens:
    print("\nWEEK BY WEEK  (Monday to Sunday; the last one is partial)\n")
    print("%-11s %8s %6s %10s" % ("week of", "players", "new", "daily avg"))
    for w in weeks:
        a, b = max(w, since), min(w + 6, today)
        n = b - a + 1
        print("%-11s %8d %6d %10.1f" % (date(w), unique(a, b), sum(on(d, gap=0) for d in range(a, b + 1)),
              sum(unique(d, d) for d in range(a, b + 1)) / n))

starts = sorted({r["first"] for r in opens if r["gap"] == 0 and r["first"] > today - days})
if starts:
    width = min(follow, max(today - f for f in starts))
    print("\nRETURN, DAY BY DAY  (of the phones that started that day, the share that opened Loom N days later)\n")
    print("%-11s %5s " % ("started", "size") + "".join("%5s" % ("D%d" % k) for k in range(1, width + 1)))
    tot = [[0, 0] for _ in range(width + 1)]
    for f in starts:
        size = on(f, gap=0)
        cells = []
        for k in range(1, width + 1):
            if f + k > today: cells.append("    ."); continue
            back = sum(r["n"] for r in opens if r["first"] == f and r["day"] == f + k)
            tot[k][0] += back; tot[k][1] += size
            cells.append("%5s" % pct(back, size))
        print("%-11s %5d " % (date(f), size) + "".join(cells))
    print("%-11s %5s " % ("all", "") + "".join("%5s" % pct(tot[k][0], tot[k][1]) for k in range(1, width + 1)))

    wk = sorted({monday(f) for f in starts})
    wmax = min(follow // 7 + 1, max(today - f for f in starts) // 7)
    if wmax >= 1:
        print("\nRETURN, WEEK BY WEEK  (phones that started in that week; the share that opened Loom at least once in their Nth week)\n")
        print("%-11s %5s " % ("started", "size") + "".join("%6s" % ("W%d" % k) for k in range(1, wmax + 1)))
        for w in wk:
            fs = [f for f in starts if monday(f) == w]
            size = sum(on(f, gap=0) for f in fs)
            cells = []
            for k in range(1, wmax + 1):
                ripe = [f for f in fs if f + 7 * k + 6 <= today]
                if not ripe: cells.append("     ."); continue
                back = sum(unique(f + 7 * k, f + 7 * k + 6, first=f) for f in ripe)
                cells.append("%6s" % pct(back, sum(on(f, gap=0) for f in ripe)))
            print("%-11s %5d " % (date(w), size) + "".join(cells))

if looms:
    print("\nTHE THREE LOOMS  (results from versionCode 26 on)\n")
    print("%-11s " % "" + "".join("%-22s" % n for n in ("Easy", "Normal", "Hard")))
    print("%-11s " % "" + "fin solve%  new lost   " * 3)
    for d in range(today - days + 1, today + 1):
        rs = [looms.get((d, t)) for t in "enh"]
        if not any(rs): continue
        cell = lambda r: "%-22s" % ("%3d %5s %9s" % (r["total"], pct(r["total"] - r["lost"], r["total"]),
                                     ("%d/%d" % (r["flost"], r["fresh"])) if r["fresh"] else "-") if r else "-")
        print("%-11s " % date(d) + "".join(cell(r) for r in rs))

print("""
open      phones that opened that day\x27s cloth (analytics on, online at some point)
new       of those, phones opening Loom for the first time
back1     back after one day; back7: after two to seven; back+: after more than a week
?         opens that did not say when they last opened (versionCode 25)
fin       phones that finished the day, solved or lost, on any loom (a phone that
          wove two looms is two)
solve%    solved / finished
finish%   finished / opened: the rest gave up or have not finished yet (over 100%
          while builds older than versionCode 25, which send no opens, are in use,
          or while phones weave more than one loom)
new lost  first-day phones that lost / first-day phones that finished
D1, D2..  of a day\x27s new phones, the share that opened Loom exactly N days later;
          "." means that day has not come yet; "all" pools every start day
W1, W2..  the same by week: opened at least once in days 7N to 7N+6 after starting
Not counted anywhere: players with analytics off, the website copy, archive days.""")
' "$DAYS" "$FOLLOW"
