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
 *   &mine=1          with Sr. Orra's own phones among the players (the
 *                    dashboard's "My phones" switch); without it, release
 *                    leaves them out (va_install.own, the build 'own')
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
import { CAMPAIGNS } from "../../_va/campaigns.js";

const RANGES = [7, 30, 90];
/* release: players. debug: the studio's phones, emulators and Google's test robots. lab: the
   private lab's playtests (Pocket Foundry). web: a public web copy. all: every build together.
   The summaries also hold 'own': a release build on one of Sr. Orra's own phones (the nightly
   Worker's OWN_RULE). It is not offered on its own: release adds it when `mine` is set. */
const BUILDS = ["release", "debug", "lab", "web", "all"];
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
  const mine = p.get("mine") === "1";
  const BF = (col) => (build === "all" ? "1 = 1"
    : build === "release" && mine ? `${col} IN ('release', 'own')` : `${col} = '${build}'`);
  /* The raw batches carry the build the game sent, so there his phones still say 'release':
     they are left out by install instead. */
  const NOTOWN = (col) => (build === "release" && !mine
    ? `${col} NOT IN (SELECT install FROM va_install WHERE game = ${G} AND own = 1)` : "1 = 1");
  /* The installs of the chosen builds, for the tables the summaries do not tag (purchases). */
  const INB = (col) => `${col} IN (SELECT install FROM va_daily_user WHERE game = ${G} AND ${BF("build")})`;
  /* The two sets every page starts from: each install with its first day, and
     each player-day of the chosen build. */
  const W = `inst AS (
      SELECT install, COALESCE(first_day, CAST((first_seen - ${DAY0}) / 86400000 AS INTEGER)) AS fd,
             src_source, src_campaign, country, dev_model, dev_os
      FROM va_install WHERE game = ${G}),
    du AS (SELECT * FROM va_daily_user WHERE game = ${G} AND ${BF("build")})`;
  return { game, range, build, mine, custom, T, F, all, one, G, BF, NOTOWN, INB, W };
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
    /* A first result on the first day: for Loom, a day solved or failed (va_day_result); for the
       other games, a level won (level_end with success, counted into va_daily_user.wins). */
    const first = c.game === "loom"
      ? `EXISTS (SELECT 1 FROM va_day_result r WHERE r.game = ${c.G} AND r.install = coh.install
                 AND r.played = coh.fd AND r.result <> 'left')`
      : `EXISTS (SELECT 1 FROM du x WHERE x.install = coh.install AND x.day = coh.fd AND x.wins > 0)`;
    const series = await c.all(`WITH ${c.W}
      SELECT i.fd AS day, COALESCE(i.src_source, 'unknown') AS source, COUNT(*) AS n
      FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
      WHERE i.fd BETWEEN ${c.F} AND ${c.T} GROUP BY i.fd, source ORDER BY i.fd`);
    const steps = await eventSum(c, ["first_session_step"], "step");
    const campaigns = await c.all(`WITH ${c.W}, coh AS (
        SELECT i.* FROM inst i JOIN du d ON d.install = i.install AND d.day = i.fd
        WHERE i.fd BETWEEN ${c.F} AND ${c.T})
      SELECT COALESCE(src_source, 'unknown') AS source, COALESCE(src_campaign, '') AS campaign, COUNT(*) AS n,
             SUM(${first}) AS first,
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
    /* Every event the game sent, so each game's profile on the page (its reminders and what players
       use) finds its own names. A fixed list here had left Paper Squadron's cards at nought. */
    const totals = await c.all(`SELECT name, value, SUM(events) AS events, SUM(players) AS players FROM va_event_day
                                WHERE game = ${c.G} AND ${c.BF("build")} AND day BETWEEN ${c.F} AND ${c.T} AND dim = ''
                                GROUP BY name, value`);
    const answers = await eventSum(c, ["notify_answer"], "state");
    const playerDays = await c.one(`WITH ${c.W} SELECT COUNT(*) AS n FROM du WHERE day BETWEEN ${c.F} AND ${c.T}`);
    return { k, heat, lengths, median: med, firstWeek, opens, totals, answers, playerDays: playerDays.n || 0 };
  },

  async progress(c) {
    if (c.game === "pocketfoundry") return foundryProgress(c);
    if (c.game === "papersquadron") return squadronProgress(c);
    if (c.game === "sombra") return ashenProgress(c);
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
    /* The climb (Loom's GDD 19.2, from 3 November 2026): each rung is its own
       day result, its loom column "r1", "r2", ... A rung is reached by a player
       who has a result on it; a climb's level is its highest rung solved, and
       rungs are climbed in order. Read from the results, so the nightly worker
       needs no new parameter. */
    const rungs = await c.all(`SELECT CAST(SUBSTR(loom, 2) AS INTEGER) AS lv, result, COUNT(*) AS n
                               FROM ${R} AND loom LIKE 'r%' AND COALESCE(archive, 0) = 0 GROUP BY lv, result`);
    const reach = await c.all(`SELECT CAST(SUBSTR(loom, 2) AS INTEGER) AS lv, COUNT(DISTINCT install) AS players
                               FROM ${R} AND loom LIKE 'r%' AND COALESCE(archive, 0) = 0 GROUP BY lv`);
    const reached = await c.all(`SELECT MIN(lv, 10) AS lv, COUNT(*) AS n FROM (
        SELECT install, puzzle, MAX(CASE WHEN result = 'solved' THEN CAST(SUBSTR(loom, 2) AS INTEGER) ELSE 0 END) AS lv
        FROM ${R} AND loom LIKE 'r%' AND COALESCE(archive, 0) = 0 GROUP BY install, puzzle) GROUP BY MIN(lv, 10)`);
    const climb = await eventSum(c, ["climb_ended", "shop_opened", "live_weave_toggled", "panel_closed"], "");
    return { results, opened, tries, secs, weekday, ladder, streak, s7, quilt, events, milestones, rungs, reach, reached, climb };
  },

  async money(c) {
    const offers = await offerFunnel(c);
    const failed = await failedPurchases(c);
    const rewarded = await eventSum(c, ["rewarded_ad_offered", "rewarded_ad_started", "rewarded_ad_completed"], "placement");
    const inter = await eventSum(c, ["interstitial_shown"], "");
    const revenue = await c.all(`SELECT CAST((purchase_time - ${DAY0}) / 86400000 AS INTEGER) AS day, sku, currency,
                                   SUM(price_micros) AS micros, COUNT(*) AS n, verified
                                 FROM va_purchase WHERE game = ${c.G} AND ${c.INB("install")}
                                   AND purchase_time >= ${DAY0 + c.F * 86400000}
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
                                WHERE game = ${c.G} AND day BETWEEN ${from} AND ${c.T} GROUP BY day ORDER BY day`);
    /* The free plan's limit is the database's, shared by every game: today's batches across all of them. */
    const allToday = await c.one(`SELECT COUNT(*) AS batches FROM va_batch WHERE day = ${c.T}`);
    const nightly = await c.one(`SELECT v FROM va_meta WHERE k = 'nightly_last'`);
    const logins = await c.one(`SELECT SUM(ok = 0) AS failed, SUM(ok = 1) AS ok FROM va_login`);
    const deleted = await c.one(`SELECT SUM(n) AS n FROM va_deleted WHERE game = ${c.G} AND day BETWEEN ${c.F} AND ${c.T}`);
    /* Known phones: Sr. Orra's own (left out of Players unless My phones is on) and those
       tagged by hand, such as a friend's, which stay players. */
    const known = await c.all(`SELECT SUBSTR(install, 1, 8) AS id, dev_model AS model, country, own, tag, vc_last AS vc,
                                 first_seen AS first, last_seen AS last FROM va_install
                               WHERE game = ${c.G} AND (own = 1 OR tag IS NOT NULL) ORDER BY last_seen DESC LIMIT 20`);
    return { errors, delay, consent, versions, intake, nightly: nightly.v ? JSON.parse(nightly.v) : null,
             logins, deleted: deleted.n || 0, since: from, allToday: allToday.batches || 0, known };
  },

  /* Today, every game at once: the page the phone opens on. Live where it can be (the raw
     batches of today and yesterday, so it does not wait for the twice-daily summaries), from
     the summaries where it must be (day-one return). Players only: release builds, Google's
     test robots left out by the same rule the nightly Worker applies (ROBOT below). Days are
     the collector's: UTC, so "today" starts at 01:00 Spanish time in winter. */
  async today(c) {
    const T = vaDay(), now = Date.now();
    const start = DAY0 + T * 86400000;
    const REL = `COALESCE(json_extract(e.value, '$.x.build'), 'release') = 'release'`;
    /* Sr. Orra's own phones: out unless My phones is on (va_install.own; the summaries' 'own'). */
    const OWN = c.mine ? "" : " AND COALESCE(i.own, 0) = 0";
    const DU = c.mine ? "build IN ('release', 'own')" : "build = 'release'";
    const players = `va_install i WHERE COALESCE(i.tester, 0) = 0 AND NOT ${ROBOT}${OWN}`;
    const live = await c.all(`
      SELECT b.game,
             COUNT(DISTINCT CASE WHEN b.day = ${T} THEN b.install END) AS today,
             COUNT(DISTINCT CASE WHEN b.day = ${T - 1} THEN b.install END) AS yesterday
      FROM va_batch b JOIN va_install i ON i.game = b.game AND i.install = b.install
      WHERE b.day BETWEEN ${T - 1} AND ${T} AND COALESCE(i.tester, 0) = 0 AND NOT ${ROBOT}${OWN}
        AND EXISTS (SELECT 1 FROM json_each(b.events) e WHERE ${REL})
      GROUP BY b.game`);
    const last = await c.all(`SELECT game, MAX(received) AS at FROM va_batch WHERE day >= ${T - 7} GROUP BY game`);
    const camp = CAMPAIGNS.filter((k) => vaDay(Date.parse(k.start)) <= T);
    const inList = (k) => k.countries.map((x) => `'${x.replace(/[^A-Z]/g, "")}'`).join(",");
    const fresh = await c.all(`
      SELECT i.game, COUNT(*) AS n, i.country AS country FROM ${players}
        AND i.first_seen >= ${start}
        AND EXISTS (SELECT 1 FROM va_batch b, json_each(b.events) e
                    WHERE b.game = i.game AND b.install = i.install AND b.day = ${T} AND ${REL})
      GROUP BY i.game, i.country`);
    const ads = await c.all(`
      SELECT b.game, json_extract(e.value, '$.x.currency') AS currency, SUM(json_extract(e.value, '$.x.value')) AS value
      FROM va_batch b JOIN va_install i ON i.game = b.game AND i.install = b.install, json_each(b.events) e
      WHERE b.day = ${T} AND COALESCE(i.tester, 0) = 0 AND NOT ${ROBOT}${OWN} AND json_extract(e.value, '$.n') = 'ad_paid' AND ${REL}
      GROUP BY b.game, currency`);
    const bought = await c.all(`
      SELECT game, currency, COUNT(*) AS n, SUM(COALESCE(price_micros, 0)) AS micros FROM va_purchase
      WHERE verified = 1 AND purchase_time >= ${start} GROUP BY game, currency`);
    /* Day-one return of the last seven complete cohorts (first days T-8 to T-2), from the summaries. */
    const d1 = await c.all(`
      WITH inst AS (SELECT game, install, COALESCE(first_day, CAST((first_seen - ${DAY0}) / 86400000 AS INTEGER)) AS fd
                    FROM va_install),
           du AS (SELECT game, install, day FROM va_daily_user WHERE ${DU}),
           coh AS (SELECT i.game, i.install, i.fd FROM inst i JOIN du d ON d.game = i.game AND d.install = i.install AND d.day = i.fd
                   WHERE i.fd BETWEEN ${T - 8} AND ${T - 2})
      SELECT game, COUNT(*) AS n,
             SUM(EXISTS (SELECT 1 FROM du x WHERE x.game = coh.game AND x.install = coh.install AND x.day = coh.fd + 1)) AS r
      FROM coh GROUP BY game`);

    const games = Object.keys(GAMES).map((g) => {
      const l = live.find((r) => r.game === g) || {};
      const f = fresh.filter((r) => r.game === g);
      const k = camp.find((x) => x.games.includes(g));
      const d = d1.find((r) => r.game === g) || {};
      return {
        game: g, today: l.today || 0, yesterday: l.yesterday || 0,
        newToday: f.reduce((a, r) => a + r.n, 0),
        newCampaign: k ? f.filter((r) => k.countries.includes(r.country)).reduce((a, r) => a + r.n, 0) : null,
        last: (last.find((r) => r.game === g) || {}).at || null,
        ads: ads.filter((r) => r.game === g && r.value).map((r) => ({ currency: r.currency || "", value: r.value })),
        purchases: bought.filter((r) => r.game === g).map((r) => ({ currency: r.currency || "", n: r.n, micros: r.micros })),
        d1: { n: d.n || 0, r: d.r || 0 },
      };
    });

    /* Each campaign since its first day: new players from its countries against the rest, live,
       and their day-one return from the summaries. */
    const campaigns = [];
    for (const k of camp) {
      const S = vaDay(Date.parse(k.start)), R = vaDay(Date.parse(k.review));
      const gl = k.games.map((g) => `'${g}'`).join(",");
      /* Played a release build since the first day: the summaries for every day they cover
         (an indexed look-up on va_daily_user's key), and the raw batches for today only.
         Reading the raw batches for the whole campaign expanded every event of every player
         since its first day, about a million rows per open of this page, and ran the free
         plan's five million a day out by mid-afternoon (13 November 2026). */
      const counts = await c.all(`
        SELECT i.game, (i.country IN (${inList(k)})) AS camp, COUNT(*) AS n FROM ${players}
          AND i.game IN (${gl}) AND i.first_seen >= ${DAY0 + S * 86400000}
          AND (EXISTS (SELECT 1 FROM va_daily_user d
                       WHERE d.game = i.game AND d.install = i.install AND d.day BETWEEN ${S} AND ${T} AND d.${DU})
               OR EXISTS (SELECT 1 FROM va_batch b, json_each(b.events) e
                          WHERE b.game = i.game AND b.install = i.install AND b.day = ${T} AND ${REL}))
        GROUP BY i.game, camp`);
      const ret = await c.all(`
        WITH du AS (SELECT game, install, day FROM va_daily_user WHERE ${DU}),
             coh AS (SELECT i.game, i.install, i.country,
                            COALESCE(i.first_day, CAST((i.first_seen - ${DAY0}) / 86400000 AS INTEGER)) AS fd
                     FROM va_install i WHERE i.game IN (${gl}) AND COALESCE(i.tester, 0) = 0 AND NOT ${ROBOT}${OWN})
        SELECT coh.game, (coh.country IN (${inList(k)})) AS camp, COUNT(*) AS n,
               SUM(EXISTS (SELECT 1 FROM du x WHERE x.game = coh.game AND x.install = coh.install AND x.day = coh.fd + 1)) AS r
        FROM coh JOIN du d ON d.game = coh.game AND d.install = coh.install AND d.day = coh.fd
        WHERE coh.fd BETWEEN ${S} AND ${T - 1}
        GROUP BY coh.game, camp`);
      const part = (g, flag) => {
        const a = counts.find((r) => r.game === g && !!r.camp === flag) || {};
        const b = ret.find((r) => r.game === g && !!r.camp === flag) || {};
        return { n: a.n || 0, d1n: b.n || 0, d1r: b.r || 0 };
      };
      /* Google's own figures for each game's campaign since the first day (va_ads_day). */
      const names = Object.values(k.ads || {}).map((n) => `'${String(n).replace(/'/g, "")}'`).join(",");
      const spend = names ? await c.all(`
        SELECT campaign, MAX(currency) AS currency, SUM(cost_micros) AS cost, SUM(conversions) AS installs,
               SUM(clicks) AS clicks, SUM(impressions) AS impressions,
               SUM(CASE WHEN day = ${T} THEN cost_micros ELSE 0 END) AS today
        FROM va_ads_day WHERE day >= ${S} AND campaign IN (${names}) GROUP BY campaign`) : [];
      /* And by conversion action (va_ads_conv): the Play downloads the campaign bids on beside the
         first opens Firebase matched to an ad, which Google keeps as a secondary action. */
      const byAction = names ? await c.all(`
        SELECT d.campaign, v.action, MAX(v.category) AS category, SUM(v.all_conv) AS n
        FROM va_ads_conv v JOIN (SELECT DISTINCT campaign_id, campaign FROM va_ads_day WHERE campaign IN (${names})) d
          ON d.campaign_id = v.campaign_id
        WHERE v.day >= ${S} GROUP BY d.campaign, v.action ORDER BY n DESC`) : [];
      const ads = (g) => {
        const r = spend.find((x) => k.ads && x.campaign === k.ads[g]);
        return r ? { campaign: r.campaign, currency: r.currency, cost: r.cost || 0, today: r.today || 0,
                     installs: r.installs || 0, clicks: r.clicks || 0, impressions: r.impressions || 0,
                     actions: byAction.filter((x) => x.campaign === r.campaign)
                       .map((x) => ({ action: x.action, category: x.category, n: x.n || 0 })) } : null;
      };
      campaigns.push({
        name: k.name, note: k.note, countries: k.countries, budgetEur: k.budgetEur,
        start: S, review: R, day: T - S + 1, days: R - S,
        games: k.games.map((g) => ({ game: g, campaign: part(g, true), other: part(g, false), ads: ads(g) })),
      });
    }
    const adsLast = await c.one(`SELECT v FROM va_meta WHERE k = 'ads_last'`);
    return { now, games, campaigns, adsLast: adsLast.v ? JSON.parse(adsLast.v) : null };
  },
};

/* Google's pre-launch test devices, the same rule as TESTER_RULE in workers/va-nightly/src/index.js
   (keep the two the same). The nightly run marks them as testers twice a day; between runs the
   Today page leaves them out by this. */
const ROBOT = `(COALESCE(i.dev_model, '') LIKE 'Google sdk_gphone%' OR
  (COALESCE(i.dev_screen, '') IN ('288x448','448x288','480x288','288x480') AND
   (COALESCE(i.dev_model, '') IN ('OnePlus OnePlus8Pro', 'HUAWEI HRY-LX1T') OR COALESCE(i.dev_webview, '') = '90.0.4430.210')))`;

/* The offer funnel (Money). Loom's offer and purchase events carry the placement; the other games
   name the product (item_id: Paper Squadron, AshenRise, Pocket Foundry from 8 November 2026) or the
   offer (AshenRise's and Pocket Foundry's offer cards). Each event is split by the first of those it
   carries; what carries none shows as one row, "(not named)", so the counts are never lost. Pocket
   Foundry names a completed purchase `purchase`, which counts as completed in a game that sends no
   `purchase_completed` (Loom and AshenRise send both, so theirs is not counted twice). */
const FUNNEL_KEYS = ["placement", "item_id", "offer"];
async function offerFunnel(c) {
  const rows = await c.all(`SELECT name, dim, value, SUM(events) AS events, SUM(players) AS players FROM va_event_day
      WHERE game = ${c.G} AND ${c.BF("build")} AND day BETWEEN ${c.F} AND ${c.T}
        AND name IN ('offer_shown', 'offer_dismissed', 'purchase_started', 'purchase_completed', 'purchase')
        AND dim IN ('', ${FUNNEL_KEYS.map((k) => `'${k}'`).join(", ")})
      GROUP BY name, dim, value`);
  const hasCompleted = rows.some((r) => r.name === "purchase_completed");
  const out = [];
  for (const name of ["offer_shown", "offer_dismissed", "purchase_started", "purchase_completed", "purchase"]) {
    if (name === "purchase" && hasCompleted) continue;
    const as = name === "purchase" ? "purchase_completed" : name;
    const mine = rows.filter((r) => r.name === name);
    const total = mine.filter((r) => r.dim === "").reduce((a, r) => a + (r.events || 0), 0);
    const key = FUNNEL_KEYS.find((k) => mine.some((r) => r.dim === k));
    let named = 0;
    if (key) for (const r of mine.filter((x) => x.dim === key)) {
      out.push({ name: as, value: r.value, events: r.events, players: r.players });
      named += r.events || 0;
    }
    if (total > named) out.push({ name: as, value: "(not named)", events: total - named, players: null });
  }
  return out;
}

/* Why purchases failed (Money): purchase_failed by its `state`; a failure without one as "not given";
   and Paper Squadron's cancellations, which it sends as their own event, iap_cancelled, as "cancelled". */
async function failedPurchases(c) {
  const rows = await c.all(`SELECT name, dim, value, SUM(events) AS events FROM va_event_day
      WHERE game = ${c.G} AND ${c.BF("build")} AND day BETWEEN ${c.F} AND ${c.T}
        AND ((name = 'purchase_failed' AND dim IN ('', 'state')) OR (name = 'iap_cancelled' AND dim = ''))
      GROUP BY name, dim, value`);
  const by = new Map();
  const add = (v, n) => { if (n > 0) by.set(v, (by.get(v) || 0) + n); };
  const total = rows.filter((r) => r.name === "purchase_failed" && r.dim === "").reduce((a, r) => a + (r.events || 0), 0);
  let named = 0;
  for (const r of rows.filter((x) => x.name === "purchase_failed" && x.dim === "state")) { add(r.value, r.events || 0); named += r.events || 0; }
  add("not given", total - named);
  add("cancelled", rows.filter((r) => r.name === "iap_cancelled").reduce((a, r) => a + (r.events || 0), 0));
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([value, events]) => ({ name: "purchase_failed", value, events }));
}

/* AshenRise's progress (Sombra/docs/ANALYTICS.md, section 6): per level, how runs went and with which
   hero; what kills the hero; the bosses; the three balances; what was found; the hub's spending; and,
   while players are few, one row per player. Raw batches, so at most 90 days. */
async function ashenProgress(c) {
  const from = Math.max(c.F, c.T - 89);
  const X = (k) => `json_extract(e.value, '$.x.${k}')`;
  const E = `va_batch b, json_each(b.events) e WHERE b.game = ${c.G} AND b.day BETWEEN ${from} AND ${c.T}
             AND ${c.BF(`COALESCE(${X("build")}, 'release')`)} AND ${c.NOTOWN("b.install")}`;
  const N = `json_extract(e.value, '$.n')`;
  const levels = await c.all(`SELECT ${X("level_name")} AS level, MIN(${X("world")}) AS world,
      COUNT(DISTINCT CASE WHEN ${N} = 'level_start' THEN b.install END) AS players,
      SUM(CASE WHEN ${N} = 'level_start' THEN 1 ELSE 0 END) AS starts,
      SUM(CASE WHEN ${N} = 'level_end' AND ${X("success")} = 1 THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN ${N} = 'level_end' AND ${X("success")} = 0 AND COALESCE(${X("left")}, 0) = 0 THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN ${N} = 'level_end' AND ${X("left")} = 1 THEN 1 ELSE 0 END) AS left_,
      COUNT(DISTINCT CASE WHEN ${N} = 'level_end' AND ${X("success")} = 1 THEN b.install END) AS cleared,
      SUM(CASE WHEN ${N} = 'level_start' AND ${X("auto")} = 1 THEN 1 ELSE 0 END) AS auto
    FROM ${E} AND ${N} IN ('level_start', 'level_end') AND ${X("level_name")} IS NOT NULL
    GROUP BY level ORDER BY world, CAST(SUBSTR(level, INSTR(level, '-') + 1) AS INTEGER) LIMIT 80`);
  const heroes = await c.all(`SELECT ${X("hero")} AS hero, COUNT(DISTINCT b.install) AS players,
      SUM(CASE WHEN ${X("success")} = 1 THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN ${X("success")} = 0 AND COALESCE(${X("left")}, 0) = 0 THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN ${X("left")} = 1 THEN 1 ELSE 0 END) AS left_
    FROM ${E} AND ${N} = 'level_end' GROUP BY hero ORDER BY players DESC`);
  const killers = await c.all(`SELECT ${X("killer")} AS killer, COUNT(*) AS n FROM ${E} AND ${N} = 'player_died'
    GROUP BY killer ORDER BY n DESC LIMIT 12`);
  const bosses = await c.all(`SELECT ${X("boss")} AS boss, COUNT(*) AS fights, COUNT(DISTINCT b.install) AS players,
      SUM(CASE WHEN ${X("success")} = 1 THEN 1 ELSE 0 END) AS won
    FROM ${E} AND ${N} = 'boss_fight' GROUP BY boss ORDER BY fights DESC`);
  const ledger = await c.all(`SELECT ${X("virtual_currency_name")} AS currency, ${N} AS dir,
      COALESCE(${X("source")}, ${X("item_name")}) AS what, SUM(${X("value")}) AS total, COUNT(*) AS n
    FROM ${E} AND ${N} IN ('earn_virtual_currency', 'spend_virtual_currency') GROUP BY currency, dir, what ORDER BY currency, dir, total DESC`);
  const found = await c.all(`SELECT ${X("rarity")} AS rarity, ${X("source")} AS source, COUNT(*) AS n FROM ${E} AND ${N} = 'item_found'
    GROUP BY rarity, source`);
  const joined = await c.all(`SELECT ${X("hero")} AS hero, ${X("how")} AS how, COUNT(*) AS n FROM ${E} AND ${N} = 'hero_join'
    GROUP BY hero, how`);
  const places = await c.all(`SELECT ${N} AS name, COUNT(*) AS n, COUNT(DISTINCT b.install) AS players FROM ${E}
    AND ${N} IN ('hero_upgrade', 'skill_upgrade', 'skill_equipped', 'item_equipped', 'item_enhanced', 'forge_fused', 'redeemed_upgrade',
                 'chest_opened', 'armoury_bought', 'quest_complete', 'daily_gift', 'supply_crate', 'special_used', 'world_reached',
                 'career_complete', 'commander_joined', 'player_died')
    GROUP BY name`);
  const players = await c.all(`SELECT p.install AS install, p.u AS u, p.t AS t, i.dev_model AS model, p.events AS events FROM (
      SELECT b.install, json_extract(e.value, '$.u') AS u, json_extract(e.value, '$.t') AS t,
             COUNT(*) OVER (PARTITION BY b.install) AS events,
             ROW_NUMBER() OVER (PARTITION BY b.install
                                ORDER BY json_extract(e.value, '$.u') IS NULL, json_extract(e.value, '$.t') DESC) AS rn
      FROM ${E}) p LEFT JOIN va_install i ON i.game = ${c.G} AND i.install = p.install
    WHERE p.rn = 1 ORDER BY p.t DESC LIMIT 30`);
  return { ash: true, since: from, levels, heroes, killers, bosses, ledger, found, joined, places,
    players: players.map((p) => ({ install: String(p.install).slice(0, 8), model: p.model, t: p.t, events: p.events,
      u: (() => { try { return JSON.parse(p.u) || {}; } catch (e) { return {}; } })() })) };
}

/* Pocket Foundry's progress (docs/ANALYTICS.md, "The dashboard"): read from the raw batches, which are
   kept 90 days, as the Health page reads its script errors. Small numbers are expected for months:
   the page shows counts, and one row per player while there are few. */
async function foundryProgress(c) {
  const from = Math.max(c.F, c.T - 89);
  const X = (k) => `json_extract(e.value, '$.x.${k}')`;
  const E = `va_batch b, json_each(b.events) e WHERE b.game = ${c.G} AND b.day BETWEEN ${from} AND ${c.T}
             AND ${c.BF(X("build"))} AND ${c.NOTOWN("b.install")}`;
  const N = `json_extract(e.value, '$.n')`;
  const orders = await c.all(`SELECT ${X("level_name")} AS level, MAX(${X("kind")}) AS kind,
      COUNT(DISTINCT CASE WHEN ${N} = 'level_start' THEN b.install END) AS opened,
      COUNT(DISTINCT CASE WHEN ${N} = 'level_end' AND ${X("success")} = 1 THEN b.install END) AS filled,
      SUM(CASE WHEN ${N} = 'level_end' AND ${X("success")} = 1 AND ${X("marks")} = 3 THEN 1 ELSE 0 END) AS perfect,
      SUM(CASE WHEN ${N} = 'level_end' AND ${X("success")} = 0 THEN 1 ELSE 0 END) AS left_,
      SUM(CASE WHEN ${N} = 'order_run' AND ${X("result")} = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN ${N} = 'hint_used' THEN 1 ELSE 0 END) AS hints,
      SUM(CASE WHEN ${N} = 'solution_used' THEN 1 ELSE 0 END) AS solutions
    FROM ${E} AND ${N} IN ('level_start', 'level_end', 'order_run', 'hint_used', 'solution_used') AND ${X("level_name")} IS NOT NULL
    GROUP BY level ORDER BY opened DESC, level LIMIT 60`);
  const players = await c.all(`SELECT p.install AS install, p.u AS u, p.t AS t, i.dev_model AS model, p.events AS events FROM (
      SELECT b.install, json_extract(e.value, '$.u') AS u, json_extract(e.value, '$.t') AS t,
             COUNT(*) OVER (PARTITION BY b.install) AS events,
             ROW_NUMBER() OVER (PARTITION BY b.install ORDER BY json_extract(e.value, '$.t') DESC) AS rn
      FROM ${E}) p LEFT JOIN va_install i ON i.game = ${c.G} AND i.install = p.install
    WHERE p.rn = 1 ORDER BY p.t DESC LIMIT 30`);
  const ledger = await c.all(`SELECT ${X("virtual_currency_name")} AS currency, ${N} AS dir,
      COALESCE(${X("source")}, ${X("item_name")}) AS what, SUM(${X("value")}) AS total, COUNT(*) AS n
    FROM ${E} AND ${N} IN ('earn_virtual_currency', 'spend_virtual_currency') GROUP BY currency, dir, what ORDER BY currency, dir, total DESC`);
  const fails = await c.all(`SELECT ${X("fail_code")} AS code, COUNT(*) AS n FROM ${E} AND ${N} = 'order_run' AND ${X("result")} = 'failed'
    GROUP BY code ORDER BY n DESC`);
  const places = await c.all(`SELECT ${N} AS name, COUNT(*) AS n, COUNT(DISTINCT b.install) AS players FROM ${E}
    AND ${N} IN ('repair', 'building_upgrade', 'level_running', 'tier_seen', 'connection_built', 'decoration_bought', 'store_upgrade', 'workshop_collect', 'contract_paid', 'tier_claimed', 'daily_reward')
    GROUP BY name`);
  return { pf: true, since: from, orders, players: players.map((p) => ({ install: String(p.install).slice(0, 8), model: p.model, t: p.t, events: p.events,
    u: (() => { try { return JSON.parse(p.u) || {}; } catch (e) { return {}; } })() })), ledger, fails, places };
}

/* Paper Squadron's progress: per world, runs and how they ended (level_end carries level_name,
   success and left; run_start and boss_defeated carry world_index), the folds and stars ledgers,
   health packs, gear bought and the hangar's trips to the store. Raw batches, so at most 90 days. */
async function squadronProgress(c) {
  const from = Math.max(c.F, c.T - 89);
  const X = (k) => `json_extract(e.value, '$.x.${k}')`;
  const E = `va_batch b, json_each(b.events) e WHERE b.game = ${c.G} AND b.day BETWEEN ${from} AND ${c.T}
             AND ${c.BF(`COALESCE(${X("build")}, 'release')`)} AND ${c.NOTOWN("b.install")}`;
  const N = `json_extract(e.value, '$.n')`;
  const ends = await c.all(`SELECT ${X("end_reason")} AS reason, COUNT(*) AS n FROM ${E} AND ${N} = 'run_end'
    GROUP BY reason ORDER BY n DESC`);
  const levels = await c.all(`SELECT ${X("level_name")} AS world, MIN(${X("world_index")}) AS idx,
      COUNT(DISTINCT b.install) AS players, COUNT(*) AS runs,
      SUM(CASE WHEN ${X("success")} = 1 THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN ${X("success")} = 0 AND COALESCE(${X("left")}, 0) = 0 THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN ${X("left")} = 1 THEN 1 ELSE 0 END) AS left_
    FROM ${E} AND ${N} = 'level_end' AND ${X("level_name")} IS NOT NULL GROUP BY world ORDER BY idx`);
  const bosses = await c.all(`SELECT ${X("world_index")} AS idx, COUNT(*) AS n FROM ${E} AND ${N} = 'boss_defeated' GROUP BY idx`);
  const worlds = levels.map((r) => ({ ...r, bosses: (bosses.find((b) => b.idx === r.idx) || { n: 0 }).n }));
  const ledger = await c.all(`SELECT ${X("virtual_currency_name")} AS currency, ${N} AS dir, SUM(${X("value")}) AS total, COUNT(*) AS n
    FROM ${E} AND ${N} IN ('earn_virtual_currency', 'spend_virtual_currency') GROUP BY currency, dir`);
  const packs = await c.one(`SELECT COUNT(*) AS n, SUM(${X("healed")}) AS healed FROM ${E} AND ${N} = 'health_pack'`);
  const short = await c.one(`SELECT COUNT(*) AS n FROM ${E} AND ${N} = 'shop_short'`);
  const gear = await c.all(`SELECT ${X("item_id")} AS item, COUNT(*) AS n FROM ${E} AND ${N} = 'gear_bought'
    GROUP BY item ORDER BY n DESC LIMIT 15`);
  return { ps: true, since: from, worlds, ends, ledger, packs, short, gear };
}

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
  const payers = await c.one(`SELECT COUNT(DISTINCT install) AS n FROM va_purchase WHERE game = ${c.G} AND verified = 1
                                AND ${c.INB("install")}`);
  const week = await c.all(`SELECT (puzzle + 3) % 7 AS dow, SUM(result = 'solved') AS s, SUM(result IN ('solved', 'failed')) AS n
                            FROM va_day_result WHERE game = ${c.G} AND played BETWEEN ${c.F} AND ${c.T} AND COALESCE(archive, 0) = 0
                              AND ${c.INB("install")} GROUP BY dow`);
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
    return json({ game: c.game, range: c.range, build: c.build, mine: c.mine, custom: c.custom, today: c.T, from: c.F,
                  summary: last.v ? JSON.parse(last.v) : null, ...data });
  } catch (e) {
    return json({ error: "query", detail: String(e && e.message || e).slice(0, 200) }, 500);
  }
}
