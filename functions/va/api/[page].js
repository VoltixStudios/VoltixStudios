/* Voltix Analytics — the dashboard's data, at /va/api/<page> (D-072, phase 4).
 *
 * Behind the login: the middleware refuses any request here without a valid
 * session cookie. Each page is one GET returning JSON, read from the nightly
 * summaries (va_daily_user, va_session, va_day_result, va_event_day) and from
 * va_install and va_purchase; only Health reads the raw batches, for the last
 * few days. Every number is added up inside D1, so this stays within the free
 * plan's few milliseconds of CPU however many players there are.
 *
 *   ?game=loom       a key of GAMES
 *   &range=30        7, 30 or 90 days, ending today
 *   &build=release   release, debug or all
 *
 * The game and the build are checked against fixed lists before they are
 * written into SQL; numbers are integers. Nothing a player sent is ever put
 * into a query. Strings a player sent (a model name, a campaign) do come back
 * in the answers, and the page treats them as text, never as HTML.
 *
 * Groups under five players are the page's to hide ("under 5"); the counts
 * come back exact, so totals still add up.
 */

import { GAMES } from "../../_va/games.js";
import { vaDay, DAY0 } from "../../_va/lib.js";

const RANGES = [7, 30, 90];
const BUILDS = ["release", "debug", "all"];
const COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 30];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function ctx(url, env) {
  const p = url.searchParams;
  const game = Object.prototype.hasOwnProperty.call(GAMES, p.get("game")) ? p.get("game") : "loom";
  const build = BUILDS.includes(p.get("build")) ? p.get("build") : "release";
  /* A custom range: from and to as day numbers (days since 1 January 2026), inside
     what can exist (day 0 to today) and at most 400 days long. Anything else falls
     back to the preset range ending today. Every page reads `T` as the range's
     last day, so "today" figures become that day's. */
  const today = vaDay();
  const pf = parseInt(p.get("from"), 10), pt = parseInt(p.get("to"), 10);
  const custom = Number.isInteger(pf) && Number.isInteger(pt) && pf >= 0 && pf <= pt && pt <= today && pt - pf < 400;
  const T = custom ? pt : today;
  const range = custom ? pt - pf + 1
    : (RANGES.includes(parseInt(p.get("range"), 10)) ? parseInt(p.get("range"), 10) : 30);
  const F = T - range + 1;
  const db = env.VA;
  const all = async (sql) => (await db.prepare(sql).all()).results || [];
  const one = async (sql) => (await db.prepare(sql).first()) || {};
  const G = `'${game}'`;
  const BF = (col) => (build === "all" ? "1 = 1" : `${col} = '${build}'`);
  /* The two sets every page starts from: each install with its first day, and
     each player-day of the chosen build. */
  const W = `inst AS (
      SELECT install, COALESCE(first_day, CAST((first_seen - ${DAY0}) / 86400000 AS INTEGER)) AS fd,
             src_source, src_campaign, country, dev_model, dev_os
      FROM va_install WHERE game = ${G}),
    du AS (SELECT * FROM va_daily_user WHERE game = ${G} AND ${BF("build")})`;
  return { game, range, build, custom, T, F, all, one, G, BF, W };
}

/* Integer median of `col` over `from` (a FROM ... WHERE clause), inside D1. */
async function median(c, col, from) {
  const r = await c.one(`SELECT ${col} AS v FROM ${from} ORDER BY ${col}
                         LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM ${from})`);
  return r.v === undefined ? null : r.v;
}

async function eventSum(c, names, dim) {
  const list = names.map((n) => `'${n}'`).join(",");
  return c.all(`SELECT name, value, SUM(events) AS events, SUM(players) AS players FROM va_event_day
                WHERE game = ${c.G} AND ${c.BF("build")} AND day BETWEEN ${c.F} AND ${c.T}
                  AND name IN (${list}) AND dim = '${dim}'
                GROUP BY name, value`);
}

const PAGES = {
  async overview(c) {
    const series = await c.all(`WITH ${c.W}
      SELECT d.day, COUNT(*) AS players, SUM(CASE WHEN i.fd = d.day THEN 1 ELSE 0 END) AS new
      FROM du d LEFT JOIN inst i USING (install)
      WHERE d.day BETWEEN ${c.F} AND ${c.T} GROUP BY d.day ORDER BY d.day`);
    const d1 = await c.one(`WITH ${c.W}, coh AS (
        SELECT i.install, i.fd FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
        WHERE i.fd BETWEEN ${c.T - 14} AND ${c.T - 1})
      SELECT COUNT(*) AS n, SUM(EXISTS (SELECT 1 FROM du x WHERE x.install = coh.install AND x.day = coh.fd + 1)) AS r FROM coh`);
    const stick = await c.one(`WITH ${c.W}
      SELECT (SELECT COUNT(*) FROM du WHERE day = ${c.T}) AS dau,
             (SELECT COUNT(DISTINCT install) FROM du WHERE day BETWEEN ${c.T - 29} AND ${c.T}) AS mau,
             (SELECT AVG(seconds) FROM du WHERE day = ${c.T}) AS seconds,
             (SELECT SUM(rev_micros + ad_micros) FROM du WHERE day BETWEEN ${c.F} AND ${c.T}) AS money`);
    const sources = await c.all(`WITH ${c.W}
      SELECT COALESCE(i.src_source, 'unknown') AS label, COUNT(*) AS n
      FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
      WHERE i.fd BETWEEN ${c.F} AND ${c.T} GROUP BY label ORDER BY n DESC`);
    const versions = await c.all(`WITH ${c.W}
      SELECT COALESCE(vc, 0) AS label, COUNT(DISTINCT install) AS n FROM du
      WHERE day BETWEEN ${c.T - 6} AND ${c.T} GROUP BY label ORDER BY label DESC`);
    return { series, d1, stick, sources, versions, gates: c.game === "loom" ? await loomGates(c) : [] };
  },

  async acquisition(c) {
    const series = await c.all(`WITH ${c.W}
      SELECT i.fd AS day, COALESCE(i.src_source, 'unknown') AS source, COUNT(*) AS n
      FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
      WHERE i.fd BETWEEN ${c.F} AND ${c.T} GROUP BY i.fd, source ORDER BY i.fd`);
    const steps = await eventSum(c, ["first_session_step"], "step");
    const campaigns = await c.all(`WITH ${c.W}, coh AS (
        SELECT i.* FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
        WHERE i.fd BETWEEN ${c.F} AND ${c.T})
      SELECT COALESCE(src_source, 'unknown') AS source, COALESCE(src_campaign, '') AS campaign, COUNT(*) AS n,
             SUM(EXISTS (SELECT 1 FROM va_day_result r WHERE r.game = ${c.G} AND r.install = coh.install
                          AND r.played = coh.fd AND r.result <> 'left')) AS first,
             SUM(CASE WHEN fd < ${c.T} THEN 1 ELSE 0 END) AS d1n,
             SUM(fd < ${c.T} AND EXISTS (SELECT 1 FROM du x WHERE x.install = coh.install AND x.day = coh.fd + 1)) AS d1r
      FROM coh GROUP BY source, campaign ORDER BY n DESC LIMIT 20`);
    const split = (col) => c.all(`WITH ${c.W}
      SELECT COALESCE(i.${col}, 'unknown') AS label, COUNT(*) AS n
      FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
      WHERE i.fd BETWEEN ${c.F} AND ${c.T} GROUP BY label ORDER BY n DESC LIMIT 8`);
    return { series, steps, campaigns, country: await split("country"), model: await split("dev_model"), os: await split("dev_os") };
  },

  async retention(c) {
    /* Sixty days of cohorts: the table shows the last month, the curve needs the
       month before it so that every day up to D30 has cohorts old enough. */
    const from = Math.min(c.F, c.T - 60);
    const coh = `coh AS (SELECT i.install, i.fd, i.src_source FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
                          WHERE i.fd BETWEEN ${from} AND ${c.T})`;
    const sizes = await c.all(`WITH ${c.W}, ${coh} SELECT fd, COUNT(*) AS n FROM coh GROUP BY fd ORDER BY fd DESC`);
    const cells = await c.all(`WITH ${c.W}, ${coh}
      SELECT coh.fd, x.day - coh.fd AS k, COUNT(DISTINCT x.install) AS r FROM coh JOIN du x ON x.install = coh.install
      WHERE x.day - coh.fd BETWEEN 1 AND 30 GROUP BY coh.fd, k`);
    const last = await c.all(`WITH ${c.W}, ${coh}
      SELECT fd, lastk, COUNT(*) AS n FROM (
        SELECT coh.fd, MIN((SELECT MAX(day) FROM du x WHERE x.install = coh.install) - coh.fd, 31) AS lastk FROM coh)
      GROUP BY fd, lastk`);
    const d7 = (key) => c.all(`WITH ${c.W}, ${coh}
      SELECT ${key} AS label, COUNT(*) AS n,
             SUM(EXISTS (SELECT 1 FROM du x WHERE x.install = coh.install AND x.day = coh.fd + 7)) AS r
      FROM coh WHERE fd <= ${c.T - 7} GROUP BY label ORDER BY n DESC LIMIT 8`);
    const firstLoom = `(SELECT r.loom FROM va_day_result r WHERE r.game = ${c.G} AND r.install = coh.install
                        AND r.played = coh.fd AND r.archive IS NOT 1 ORDER BY r.puzzle LIMIT 1)`;
    const firstResult = `(SELECT MAX(CASE r.result WHEN 'solved' THEN 'solved' WHEN 'failed' THEN 'failed' ELSE 'left' END)
                          FROM va_day_result r WHERE r.game = ${c.G} AND r.install = coh.install AND r.played = coh.fd)`;
    const churn = await c.all(`WITH ${c.W}, lastday AS (SELECT install, MAX(day) AS ld FROM du GROUP BY install)
      SELECT CASE WHEN COALESCE(d.streak, 0) <= 1 THEN '1' WHEN d.streak = 2 THEN '2' WHEN d.streak = 3 THEN '3'
                  WHEN d.streak <= 6 THEN '4–6' WHEN d.streak <= 13 THEN '7–13' ELSE '14+' END AS label, COUNT(*) AS n
      FROM lastday l JOIN du d ON d.install = l.install AND d.day = l.ld
      WHERE l.ld BETWEEN ${c.F} AND ${c.T - 7} GROUP BY label`);
    const back = await c.one(`WITH ${c.W}
      SELECT COUNT(*) AS n FROM du d WHERE d.day BETWEEN ${c.F} AND ${c.T}
        AND NOT EXISTS (SELECT 1 FROM du y WHERE y.install = d.install AND y.day BETWEEN d.day - 7 AND d.day - 1)
        AND EXISTS (SELECT 1 FROM du z WHERE z.install = d.install AND z.day < d.day - 7)`);
    return {
      today: c.T, cols: COLS, sizes, cells, last,
      segments: {
        source: await d7("COALESCE(src_source, 'unknown')"),
        loom: c.game === "loom" ? await d7(`COALESCE(${firstLoom}, 'none')`) : [],
        first: c.game === "loom" ? await d7(`COALESCE(${firstResult}, 'no result')`) : [],
      },
      churn, returned: back.n || 0,
    };
  },

  async engagement(c) {
    const k = await c.one(`WITH ${c.W}
      SELECT (SELECT COUNT(*) FROM du WHERE day = ${c.T}) AS dau,
             (SELECT COUNT(DISTINCT install) FROM du WHERE day BETWEEN ${c.T - 6} AND ${c.T}) AS wau,
             (SELECT COUNT(DISTINCT install) FROM du WHERE day BETWEEN ${c.T - 29} AND ${c.T}) AS mau,
             (SELECT 1.0 * SUM(sessions) / COUNT(*) FROM du WHERE day BETWEEN ${c.F} AND ${c.T}) AS spd,
             (SELECT AVG(seconds) FROM du WHERE day BETWEEN ${c.F} AND ${c.T}) AS seconds`);
    const S = `va_session WHERE game = ${c.G} AND ${c.BF("build")} AND day BETWEEN ${c.F} AND ${c.T} AND start_ms IS NOT NULL`;
    /* The player's own clock: tz_offset from app_open, else Spain's winter hour. */
    const local = `(start_ms + COALESCE(tz_offset, 60) * 60000)`;
    const heat = await c.all(`SELECT ((${local} / 86400000) + 3) % 7 AS dow, (${local} % 86400000) / 3600000 AS hour, COUNT(*) AS n
                              FROM ${S} GROUP BY dow, hour`);
    const lengths = await c.all(`SELECT CASE WHEN seconds < 60 THEN 0 WHEN seconds < 120 THEN 1 WHEN seconds < 300 THEN 2
                                   WHEN seconds < 600 THEN 3 WHEN seconds < 1200 THEN 4 ELSE 5 END AS b, COUNT(*) AS n
                                 FROM ${S} GROUP BY b`);
    const med = await median(c, "seconds", S);
    const firstWeek = await c.all(`WITH ${c.W}
      SELECT days, COUNT(*) AS n FROM (
        SELECT i.install, (SELECT COUNT(*) FROM du x WHERE x.install = i.install AND x.day BETWEEN i.fd AND i.fd + 6) AS days
        FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd WHERE i.fd BETWEEN ${c.F} AND ${c.T - 7})
      GROUP BY days`);
    const opens = await eventSum(c, ["app_open"], "cause");
    const totals = await eventSum(c, ["reminder_offered", "reminder_accepted", "reminder_declined", "reminder_permission_denied",
      "reminder_opened", "stats_opened", "quilt_opened", "archive_opened", "solution_replayed", "help_opened", "share_pressed",
      "level_start", "shop_open"], "");
    const playerDays = await c.one(`WITH ${c.W} SELECT COUNT(*) AS n FROM du WHERE day BETWEEN ${c.F} AND ${c.T}`);
    return { k, heat, lengths, median: med, firstWeek, opens, totals, playerDays: playerDays.n || 0 };
  },

  async progress(c) {
    if (c.game !== "loom") return { note: "This game's progress pages arrive with its events." };
    const R = `va_day_result WHERE game = ${c.G} AND played BETWEEN ${c.F} AND ${c.T}
               AND install IN (SELECT install FROM va_daily_user WHERE game = ${c.G} AND ${c.BF("build")})`;
    const results = await c.all(`SELECT loom, result, COUNT(*) AS n FROM ${R} GROUP BY loom, result`);
    /* Played: players who started at least one try on a loom, per day (a player
       who switches looms inside the game is counted on each one they try). The
       loom the game opens on at launch is not what was played. */
    const opened = await eventSum(c, ["puzzle_started"], "loom");
    const tries = await c.all(`SELECT loom, MIN(tries, 5) AS t, COUNT(*) AS n FROM ${R} AND result = 'solved' GROUP BY loom, t`);
    const secs = {};
    for (const l of ["e", "n", "h", ""]) {
      secs[l] = await median(c, "seconds", `${R} AND result = 'solved' AND loom = '${l}' AND seconds IS NOT NULL`);
    }
    const weekday = await c.all(`SELECT loom, (puzzle + 3) % 7 AS dow, SUM(result = 'solved') AS solved, SUM(result = 'failed') AS failed
                                 FROM ${R} AND COALESCE(archive, 0) = 0 GROUP BY loom, dow`);
    const ladder = await c.one(`WITH ${c.W}, life AS (SELECT install, COUNT(*) AS days FROM du GROUP BY install)
      SELECT COUNT(*) AS d1, SUM(days >= 3) AS d3, SUM(days >= 7) AS d7, SUM(days >= 14) AS d14,
             SUM(days >= 30) AS d30, SUM(days >= 60) AS d60, SUM(days >= 100) AS d100 FROM life`);
    const streak = await median(c, "streak",
      `va_daily_user WHERE game = ${c.G} AND ${c.BF("build")} AND day = ${c.T} AND streak IS NOT NULL`);
    const s7 = await c.one(`SELECT COUNT(*) AS n, SUM(streak >= 7) AS s7 FROM va_daily_user
                            WHERE game = ${c.G} AND ${c.BF("build")} AND day = ${c.T}`);
    const quilt = await median(c, "squares", `(SELECT install, COUNT(*) AS squares FROM va_day_result
      WHERE game = ${c.G} AND result <> 'left' GROUP BY install)`);
    const events = await eventSum(c, ["loom_advice_shown", "loom_advice_taken", "hint_taken", "extra_weave_taken", "archive_opened"], "");
    const milestones = await eventSum(c, ["milestone_shown"], "which");
    return { results, opened, tries, secs, weekday, ladder, streak, s7, quilt, events, milestones };
  },

  async money(c) {
    const offers = await eventSum(c, ["offer_shown", "offer_dismissed", "purchase_started", "purchase_completed"], "placement");
    const failed = await eventSum(c, ["purchase_failed"], "state");
    const rewarded = await eventSum(c, ["rewarded_ad_offered", "rewarded_ad_started", "rewarded_ad_completed"], "placement");
    const inter = await eventSum(c, ["interstitial_shown"], "");
    const revenue = await c.all(`SELECT CAST((purchase_time - ${DAY0}) / 86400000 AS INTEGER) AS day, sku, currency,
                                   SUM(price_micros) AS micros, COUNT(*) AS n, verified
                                 FROM va_purchase WHERE game = ${c.G} AND purchase_time >= ${DAY0 + c.F * 86400000}
                                   AND purchase_time < ${DAY0 + (c.T + 1) * 86400000}
                                 GROUP BY day, sku, currency, verified ORDER BY day`);
    const k = await c.one(`WITH ${c.W}
      SELECT (SELECT COUNT(*) FROM du WHERE day BETWEEN ${c.F} AND ${c.T}) AS playerDays,
             (SELECT SUM(rev_micros) FROM du WHERE day BETWEEN ${c.F} AND ${c.T}) AS rev,
             (SELECT SUM(ad_micros) FROM du WHERE day BETWEEN ${c.F} AND ${c.T}) AS ads,
             (SELECT COUNT(DISTINCT install) FROM du WHERE day BETWEEN ${c.F} AND ${c.T}) AS players,
             (SELECT COUNT(DISTINCT p.install) FROM va_purchase p WHERE p.game = ${c.G} AND p.verified = 1
                AND p.install IN (SELECT install FROM du WHERE day BETWEEN ${c.F} AND ${c.T})) AS payers`);
    return { offers, failed, rewarded, inter, revenue, k };
  },

  async health(c) {
    const from = c.T - Math.min(c.range, 14) + 1;   // the raw batches are read for two weeks at most
    const B = `va_batch b, json_each(b.events) e WHERE b.game = ${c.G} AND b.day BETWEEN ${from} AND ${c.T}`;
    const errors = await c.all(`SELECT b.vc AS vc, json_extract(e.value, '$.x.line') AS line, json_extract(e.value, '$.x.column') AS col,
                                  json_extract(e.value, '$.x.error_kind') AS kind, json_extract(e.value, '$.x.where') AS place, COUNT(*) AS n
                                FROM ${B} AND json_extract(e.value, '$.n') = 'js_error'
                                GROUP BY vc, line, col, kind, place ORDER BY n DESC LIMIT 15`);
    const delay = await c.one(`SELECT COUNT(*) AS n, AVG(json_extract(e.value, '$.x.queue_delay_s')) AS avg,
                                 SUM(json_extract(e.value, '$.x.queue_delay_s') > 3600) AS late
                               FROM ${B}`);
    const consent = await eventSum(c, ["consent_status"], "status");
    const versions = await c.all(`SELECT vc, COUNT(DISTINCT install) AS n FROM va_daily_user
                                  WHERE game = ${c.G} AND day BETWEEN ${c.T - 6} AND ${c.T} GROUP BY vc ORDER BY vc DESC`);
    const intake = await c.all(`SELECT day, COUNT(*) AS batches, SUM(n) AS kept, SUM(refused) AS refused FROM va_batch
                                WHERE day BETWEEN ${from} AND ${c.T} GROUP BY day ORDER BY day`);
    const nightly = await c.one(`SELECT v FROM va_meta WHERE k = 'nightly_last'`);
    const logins = await c.one(`SELECT SUM(ok = 0) AS failed, SUM(ok = 1) AS ok FROM va_login`);
    const deleted = await c.one(`SELECT SUM(n) AS n FROM va_deleted WHERE game = ${c.G} AND day BETWEEN ${c.F} AND ${c.T}`);
    return { errors, delay, consent, versions, intake, nightly: nightly.v ? JSON.parse(nightly.v) : null,
             logins, deleted: deleted.n || 0, since: from };
  },
};

/* GDD_LOOM.md §21: the eight gates, each with its number, its line and its sample. */
async function loomGates(c) {
  const ev = async (name, dim = "", value = null) => {
    const r = await c.one(`SELECT SUM(players) AS p, SUM(events) AS e FROM va_event_day
      WHERE game = ${c.G} AND ${c.BF("build")} AND day BETWEEN ${c.F} AND ${c.T} AND name = '${name}' AND dim = '${dim}'
      ${value === null ? "" : `AND value = '${value}'`}`);
    return { p: r.p || 0, e: r.e || 0 };
  };
  const firstDays = await c.one(`WITH ${c.W} SELECT COUNT(*) AS n FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
                                 WHERE i.fd BETWEEN ${c.F} AND ${c.T}`);
  const helpFirst = await ev("help_opened", "first_day", "1");
  const d1 = await c.one(`WITH ${c.W}, coh AS (SELECT i.install, i.fd FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
                                               WHERE i.fd BETWEEN ${c.F} AND ${c.T - 1})
    SELECT COUNT(*) AS n, SUM(EXISTS (SELECT 1 FROM du x WHERE x.install = coh.install AND x.day = coh.fd + 1)) AS r FROM coh`);
  const offered = await ev("reminder_offered"), accepted = await ev("reminder_accepted");
  const shared = await ev("share_pressed"), solved = await ev("puzzle_solved");
  const big = await c.one(`WITH ${c.W}, sizes AS (SELECT i.fd, COUNT(*) AS n FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
                                                  WHERE i.fd <= ${c.T - 7} GROUP BY i.fd)
    SELECT MAX(n) AS biggest FROM sizes`);
  const d7 = await c.one(`WITH ${c.W}, sizes AS (SELECT i.fd, COUNT(*) AS n FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
                                                 WHERE i.fd <= ${c.T - 7} GROUP BY i.fd HAVING COUNT(*) >= 100),
    coh AS (SELECT i.install, i.fd FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd WHERE i.fd IN (SELECT fd FROM sizes))
    SELECT COUNT(*) AS n, SUM(EXISTS (SELECT 1 FROM du x WHERE x.install = coh.install AND x.day = coh.fd + 7)) AS r FROM coh`);
  const payers = await c.one(`SELECT COUNT(DISTINCT install) AS n FROM va_purchase WHERE game = ${c.G} AND verified = 1`);
  const week = await c.all(`SELECT (puzzle + 3) % 7 AS dow, SUM(result = 'solved') AS s, SUM(result IN ('solved', 'failed')) AS n
                            FROM va_day_result WHERE game = ${c.G} AND played BETWEEN ${c.F} AND ${c.T} AND COALESCE(archive, 0) = 0
                            GROUP BY dow`);
  const quilt = await ev("quilt_opened"), stats = await ev("stats_opened");
  return [
    { n: 1, name: "It teaches itself", num: helpFirst.p, den: firstDays.n || 0, kind: "low",
      reading: "Help opened on a first day, of all first days" },
    { n: 2, name: "The day lands", num: d1.r || 0, den: d1.n || 0, kind: "watch",
      reading: "D1 return among new players; the gate asks whether it rises after §8" },
    { n: 3, name: "The reminder is wanted", num: accepted.p, den: offered.p, kind: "watch",
      reading: "Accepted, of those offered" },
    { n: 4, name: "People share", num: shared.e, den: solved.e, kind: "line", line: 0.05,
      reading: "Shares per solved day; the line is 5%" },
    { n: 5, name: "It holds a week", num: d7.r || 0, den: d7.n || 0, kind: "line", line: 0.2, min: 100,
      reading: `D7 on cohorts of 100 or more; the largest so far is ${big.biggest || 0}` },
    { n: 6, name: "Someone pays", num: payers.n || 0, den: null, kind: "any",
      reading: "Players with a purchase Google signed, ever" },
    { n: 7, name: "Hard days are puzzles", week, kind: "week",
      reading: "Solve rate by weekday; a dip is expected, a collapse is not" },
    { n: 8, name: "The Quilt is wanted", num: quilt.e, den: stats.e, kind: "line", line: 1,
      reading: "Quilt opened, against statistics opened; the line is more than statistics" },
  ];
}

export async function onRequestGet({ request, env, params }) {
  if (!env.VA) return json({ error: "no store" }, 503);
  const page = PAGES[params.page];
  if (!page) return json({ error: "page" }, 404);
  const c = ctx(new URL(request.url), env);
  try {
    const data = await page(c);
    const last = await c.one(`SELECT v FROM va_meta WHERE k = 'nightly_last'`);
    return json({ game: c.game, range: c.range, build: c.build, custom: c.custom, today: c.T, from: c.F,
                  summary: last.v ? JSON.parse(last.v) : null, ...data });
  } catch (e) {
    return json({ error: "query", detail: String(e && e.message || e).slice(0, 200) }, 500);
  }
}
