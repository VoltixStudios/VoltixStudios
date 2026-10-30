/* Voltix Analytics — the nightly summaries (D-072, phase 3 of the brief).
 *
 * A Worker with a cron trigger and nothing else: it has no address, answers
 * no request, and reaches the database only through its D1 binding. Pages
 * Functions cannot run on a schedule, which is the only reason it is not one.
 *
 * Twice a day (08:00 and 22:00 in Spain; wrangler.jsonc) it rebuilds, from the raw
 * batches the collector wrote:
 *   va_session      one row per sitting
 *   va_daily_user   one row per player per day (retention, engagement)
 *   va_day_result   Loom: the last word on each day and loom
 *   va_event_day    every event counted per day, and split by DIMS
 * for the last REDO days and today, because a phone may hold events offline
 * for up to 72 hours. Then it deletes raw batches older than KEEP_DAYS.
 *
 * All the work is SQL run inside D1 (json_each over each batch's events), so
 * the Worker's own CPU time stays far under the free plan's limit. What it
 * costs in D1 rows written is the summaries for four days, deleted and
 * written again: at a thousand players a day, roughly 30,000 rows a run, so
 * 60,000 a day, under the free daily allowance of 100,000; at Loom's size today, a few hundred.
 *
 * VA_BACKFILL_DAYS (a variable, not a secret) widens the window once: set it
 * for the first run after deployment, or after a change to these summaries,
 * then remove it. The tests use it to rebuild everything they seeded.
 */

const DAY0 = Date.UTC(2026, 0, 1);              // the day zero Loom and the collector count from
const REDO = 3;                                 // days recalculated before today
const KEEP_DAYS = 90;                           // raw batches kept (D-074)

/* The parameters the pages split by. A row is written only where an event
   carries the parameter, so one list serves every game. */
const DIMS = [
  "placement", "cause", "step", "loom", "result", "state", "source", "item_id",
  "variant", "level_name", "hero", "kind", "offer", "which", "from", "ad_format",
  "first", "success", "world", "boss", "killer", "virtual_currency_name", "item_name",
  "status", "first_day",
];

export const vaDay = (ms) => Math.floor((ms - DAY0) / 86400000);

/* Every event of every batch that can hold a day in the window: a batch
   arrives on or after the day of the events it carries. */
/* The build an event counts under: what the game said ('release', 'debug'), except
   that an install marked as a tester counts as 'debug' whatever it sent, so Google's
   pre-launch robots never appear among the players. */
const EV = `ev AS (
  SELECT b.game, b.install, b.platform, b.country, b.vc,
         CASE WHEN (SELECT tester FROM va_install i WHERE i.game = b.game AND i.install = b.install) = 1
              THEN 'debug' ELSE COALESCE(json_extract(e.value, '$.x.build'), 'release') END AS bld,
         json_extract(e.value, '$.n') AS n,
         json_extract(e.value, '$.t') AS t,
         json_extract(e.value, '$.s') AS s,
         COALESCE(json_extract(e.value, '$.d'), b.day) AS d,
         e.value AS v
  FROM va_batch b, json_each(b.events) e
  WHERE b.day >= ?1
)`;

const X = (k) => `json_extract(v, '$.x.${k}')`;

export function statements(from) {
  const s = [];

  s.push(["DELETE FROM va_session WHERE day >= ?1", [from]]);
  s.push([`WITH ${EV}
    INSERT OR REPLACE INTO va_session (game, install, session, day, start_ms, end_ms, events, seconds, cause, tz_offset, build)
    SELECT game, install, s, MIN(d), MIN(t), MAX(t), COUNT(*),
           CAST(SUM(COALESCE(${X("engagement_time_msec")}, 0)) / 1000 AS INTEGER),
           MAX(CASE WHEN n = 'app_open' THEN ${X("cause")} END),
           MAX(CASE WHEN n = 'app_open' THEN ${X("tz_offset")} END),
           MAX(bld)
    FROM ev WHERE s IS NOT NULL
    GROUP BY game, install, s
    HAVING MIN(d) >= ?1`, [from]]);

  s.push(["DELETE FROM va_daily_user WHERE day >= ?1", [from]]);
  s.push([`WITH ${EV}
    INSERT INTO va_daily_user (game, install, day, platform, build, vc, country, events, sessions, seconds,
                               wins, losses, left_, hints, ads, ad_micros, streak, payer)
    SELECT game, install, d, MAX(platform), MAX(bld), MAX(vc), MAX(country), COUNT(*), COUNT(DISTINCT s),
           CAST(SUM(COALESCE(${X("engagement_time_msec")}, 0)) / 1000 AS INTEGER),
           SUM(CASE WHEN (n = 'day_result' AND ${X("result")} = 'solved') OR (n = 'level_end' AND ${X("success")} = 1) THEN 1 ELSE 0 END),
           SUM(CASE WHEN (n = 'day_result' AND ${X("result")} = 'failed')
                      OR (n = 'level_end' AND ${X("success")} = 0 AND COALESCE(${X("left")}, 0) = 0) THEN 1 ELSE 0 END),
           SUM(CASE WHEN (n = 'day_result' AND ${X("result")} = 'left') OR (n = 'level_end' AND ${X("left")} = 1) THEN 1 ELSE 0 END),
           SUM(CASE WHEN n IN ('hint_taken', 'hint_used') THEN 1 ELSE 0 END),
           SUM(CASE WHEN n = 'rewarded_ad_completed' THEN 1 ELSE 0 END),
           SUM(CASE WHEN n = 'ad_paid' THEN CAST(ROUND(COALESCE(${X("value")}, 0) * 1000000) AS INTEGER) ELSE 0 END),
           MAX(json_extract(v, '$.u.streak')),
           MAX(json_extract(v, '$.u.payer'))
    FROM ev WHERE d >= ?1
    GROUP BY game, install, d`, [from]]);
  /* Revenue counts only what Google signed (va_purchase.verified), on the day it was bought. */
  s.push([`UPDATE va_daily_user SET rev_micros = COALESCE((
      SELECT SUM(p.price_micros) FROM va_purchase p
      WHERE p.game = va_daily_user.game AND p.install = va_daily_user.install AND p.verified = 1
        AND p.price_micros IS NOT NULL AND p.purchase_time IS NOT NULL
        AND CAST((p.purchase_time - ${DAY0}) / 86400000 AS INTEGER) = va_daily_user.day), 0)
    WHERE day >= ?1`, [from]]);

  s.push(["DELETE FROM va_day_result WHERE played >= ?1", [from]]);
  s.push([`WITH ${EV}
    INSERT OR REPLACE INTO va_day_result (game, install, puzzle, loom, played, result, tries, seconds, hints, archive)
    SELECT game, install, puzzle, loom, d, result, tries, seconds, hints, archive FROM (
      SELECT game, install, d, ${X("day_number")} AS puzzle, COALESCE(${X("loom")}, '') AS loom,
             ${X("result")} AS result, ${X("tries")} AS tries, ${X("seconds")} AS seconds,
             ${X("hints")} AS hints, ${X("archive")} AS archive,
             ROW_NUMBER() OVER (PARTITION BY game, install, ${X("day_number")}, COALESCE(${X("loom")}, '')
                                ORDER BY CASE WHEN ${X("result")} = 'left' THEN 0 ELSE 1 END DESC, t DESC) AS rn
      FROM ev WHERE n = 'day_result' AND d >= ?1 AND ${X("day_number")} IS NOT NULL AND ${X("result")} IS NOT NULL
    ) WHERE rn = 1`, [from]]);

  s.push(["DELETE FROM va_event_day WHERE day >= ?1", [from]]);
  s.push([`WITH ${EV}
    INSERT INTO va_event_day (game, day, build, name, dim, value, events, players)
    SELECT game, d, bld, n, '', '', COUNT(*), COUNT(DISTINCT install)
    FROM ev WHERE d >= ?1 GROUP BY game, d, bld, n`, [from]]);
  for (const dim of DIMS) {
    s.push([`WITH ${EV}
      INSERT INTO va_event_day (game, day, build, name, dim, value, events, players)
      SELECT game, d, bld, n, '${dim}', CAST(${X(dim)} AS TEXT), COUNT(*), COUNT(DISTINCT install)
      FROM ev WHERE d >= ?1 AND ${X(dim)} IS NOT NULL
      GROUP BY game, d, bld, n, CAST(${X(dim)} AS TEXT)`, [from]]);
  }
  return s;
}

/* Google's pre-launch report installs the release build on its own phones and
   emulators. Its emulators name themselves (the model starts "Google sdk_gphone");
   those are marked as testers here. Its real phones cannot be told apart from
   the server, so they are marked by hand, and from Loom's next version the app
   recognises Google's test lab itself and labels its events 'debug'. */
const TESTER_RULE = "UPDATE va_install SET tester = 1 WHERE tester IS NULL AND dev_model LIKE 'Google sdk_gphone%'";

/* `source` says who asked: the schedule, or the dashboard's Refresh now button. */
export async function nightly(env, now = Date.now(), source = "schedule") {
  const db = env.VA;
  await db.prepare(TESTER_RULE).run();
  const today = vaDay(now);
  const back = parseInt(env.VA_BACKFILL_DAYS || "", 10);
  const from = today - (Number.isFinite(back) && back > REDO ? back : REDO);
  const started = Date.now();
  await db.batch(statements(from).map(([sql, args]) => db.prepare(sql).bind(...args)));
  const purged = await db.prepare("DELETE FROM va_batch WHERE day < ?").bind(today - KEEP_DAYS).run();
  const note = { at: new Date(now).toISOString(), source, from, today, ms: Date.now() - started,
                 purged: (purged.meta && purged.meta.changes) || 0 };
  await db.prepare("INSERT INTO va_meta (k, v) VALUES ('nightly_last', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v")
    .bind(JSON.stringify(note)).run();
  return note;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(nightly(env, event.scheduledTime || Date.now()));
  },
};
