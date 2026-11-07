/* Voltix Studios — Loom's day counters.
 *
 * A Cloudflare Pages Function, picked up by path like the analytics proxy next
 * door: no build step, no wrangler.toml. It answers at /loom/scores.
 *
 * What it is for: Loom's end screen would like to say "faster than 78% of
 * today's players". The game has no server and GA4 is one-way, so this is the
 * smallest thing that can answer that question honestly — one row per day, a
 * histogram of how everybody did, and nothing else.
 *
 * WHAT IS STORED, in full. One row per puzzle day, holding counts: how many
 * people solved it in one attempt, in two, … in six, how many did not solve it,
 * and how many finished inside each of six time bands. Counts, not people.
 * There is no account, no name, no advertising id, no IP address, no cloth, no
 * order of operations, and no row that belongs to anybody. A result from a
 * phone's first day is also added to a second row of the same kind, so the
 * day of a new player can be told from the day of a returning one.
 *
 * The one thing that is per-device is a check against counting the same phone
 * twice — a network retry would otherwise count a day twice and skew the very
 * numbers this exists to report. The phone makes up a random number once, keeps
 * it to itself, and sends it; what is stored is sha256(day + ':' + number),
 * never the number. Because the day is inside the hash and the number has 96
 * bits in it, two days' hashes from one phone cannot be tied to each other by
 * anybody holding this table. Those rows are deleted after a week.
 *
 * THE THREE LOOMS (from versionCode 26). A result that names its loom - "e",
 * "n" or "h", Easy, Normal or Hard - is counted in loom_result, one row per
 * day and loom, so a player is compared with the people who wove the same
 * cloth. A result that names none comes from a build older than the looms and
 * is counted in loom_day as it always was.
 *
 * THE LADDER (Loom's GDD 19.2, from 3 November 2026). A climb is sent once,
 * when it ends, as the loom "L", and its "attempts" are the level it reached:
 * 0 for none (the lost column), 1 to 7, and 8 for eight and over. So loom_result
 * holds one histogram of levels per day with no new table, and a phone is
 * compared with the people who climbed the same ladder.
 *
 * THE CLIMB AS IT GOES, AND BY COUNTRY (Loom's GDD 22.1, 7 November 2026).
 * From the build after 1.2.2 a phone sends its climb after every rung solved, not
 * only when the climb ends, so a player who stops at level 5 without losing is
 * counted at level 5 rather than not at all. A later, higher level from the
 * same phone on the same day moves its one count up a column; nothing is
 * counted twice. To do that, the climb's row in loom_seen also keeps the level
 * last counted and the country it was counted in, for the same week as the
 * hash and with nothing else beside them.
 *
 * Each climb is also counted under its country, as the tier "L:ES", the
 * country being the two letters Cloudflare already attaches to every request
 * (request.cf.country). The address itself is never read or kept. A reply
 * about the ladder carries the day's histogram for everybody and, as `here`,
 * the one for the country the request came from, so the game can offer
 * "everybody / your country" without being told where the phone is.
 *
 * Needs a D1 binding called LOOM. The schema is in schema.sql beside this file;
 * an existing database takes migrate-2026-11-07.sql once, before this file.
 */

const DAY0 = Date.UTC(2026, 0, 1);              // Loom counts days from here
/* Five tries on Easy and two extra weaves make seven; eight leaves room. The
   old one-loom table has six attempt columns, and keeps a seventh in its sixth:
   only a build older than the looms writes there, and its longest day was a
   Sunday of five tries and two extra. */
const MAXTRIES = 8;
const LOOMS = ["e", "n", "h", "L"];
/* Six time bands, in seconds. A band rather than a time because a distribution
   of exact times is a fingerprint and a histogram of bands is not. */
const BANDS = [30, 60, 120, 240, 480];

/* The game runs from file:// inside a WebView, so its origin is "null" and a
   POST carrying Content-Type: application/json is preflighted before it is
   sent. There is nothing here to protect with an origin check: the endpoint
   holds no secrets, sets no cookie and answers the same to everyone. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });

/* The preflight, and the reason this endpoint spent its life answering GET
   perfectly while never recording a single result.

   204 is a null-body status. Handing Response a body with it throws inside the
   Workers runtime, the exception leaves as a 500 (Cloudflare error 1101), and
   a browser whose preflight fails does not send the POST behind it. Every
   result the game ever produced died here, silently, on the phone. The body
   must be null, and test.sh now asks. */
const preflight = () => new Response(null, { status: 204, headers: CORS });

const today = () => Math.floor((Date.now() - DAY0) / 86400000);

const band = (seconds) => {
  for (let i = 0; i < BANDS.length; i++) if (seconds <= BANDS[i]) return i + 1;
  return BANDS.length + 1;
};

async function seenId(day, key) {
  const bytes = new TextEncoder().encode(day + ":" + key);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const shape = (row, rank) => ({
  d: row.day,
  ...(row.tier ? { l: row.tier } : {}),
  n: row.total,
  solved: row.tier ? [row.c1, row.c2, row.c3, row.c4, row.c5, row.c6, row.c7, row.c8]
                   : [row.c1, row.c2, row.c3, row.c4, row.c5, row.c6],
  lost: row.lost,
  t: [row.t1, row.t2, row.t3, row.t4, row.t5, row.t6],
  bands: BANDS,
  ...(rank === undefined ? {} : { rank }),
});

async function readDay(db, day, loom) {
  const row = loom
    ? await db.prepare("SELECT * FROM loom_result WHERE day = ? AND tier = ?").bind(day, loom).first()
    : await db.prepare("SELECT * FROM loom_day WHERE day = ?").bind(day).first();
  return row || { day, ...(loom ? { tier: loom, c7: 0, c8: 0 } : {}), total: 0, lost: 0,
                  c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0, t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, t6: 0 };
}
/* The country Cloudflare says the request came from, or null. XX is unknown
   and T1 is Tor: neither is a country anybody could be compared within. */
function countryOf(request) {
  const c = request && request.cf && request.cf.country;
  return typeof c === "string" && /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}
/* A country's histogram, as small as the game needs it. */
const here = (row, cc) => ({ cc, n: row.total, solved: [row.c1, row.c2, row.c3, row.c4, row.c5, row.c6, row.c7, row.c8],
                             lost: row.lost });
/* The ladder's reply: everybody's day, and the country's beside it. */
async function ladderReply(db, day, cc, base) {
  const out = base || shape(await readDay(db, day, "L"));
  if (cc) out.here = here(await readDay(db, day, "L:" + cc), cc);
  return out;
}
/* The loom a request names, or null for none; undefined for one that is not a loom. */
function loomOf(v) {
  if (v === undefined || v === null || v === "") return null;
  return LOOMS.indexOf(v) >= 0 ? v : undefined;
}

/* A climb, counted once per phone per day and moved up as it goes.

   The first word from a phone on a day inserts its seen row - with the level
   and the country - and counts it in "L" and in "L:<country>". A later word
   with a higher level moves that one count from the old column to the new in
   both rows, the country being the one it was first counted in. The same
   level again, or a lower one, changes nothing: a retry is a retry, and a
   climb never goes down. A seen row written before 7 November 2026 has no
   level and is left as it was counted, by a build that only ever sent once. */
async function climb(db, day, id, level, seconds, fresh, cc) {
  const col = (lv) => (lv === 0 ? "lost" : "c" + lv);
  const seen = await db.prepare("INSERT OR IGNORE INTO loom_seen (day, id, lv, cc) VALUES (?, ?, ?, ?)")
    .bind(day, id, level, cc).run();
  const tiers = (c) => (c ? ["L", "L:" + c] : ["L"]);
  if (seen.meta && seen.meta.changes) {
    const good = level > 0 && Number.isFinite(seconds) && seconds >= 3 && seconds <= 7200;
    const tcol = good ? "t" + band(seconds) : null;
    const f = fresh ? 1 : 0, fl = fresh && level === 0 ? 1 : 0;
    const sets = ["total = total + 1", col(level) + " = " + col(level) + " + 1",
                  "fresh = fresh + " + f, "flost = flost + " + fl];
    if (tcol) sets.push(tcol + " = " + tcol + " + 1");
    await db.batch(tiers(cc).map((tier) => db.prepare(
      "INSERT INTO loom_result (day, tier, total, fresh, flost, " + col(level) + (tcol ? ", " + tcol : "") + ") " +
      "VALUES (?, ?, 1, ?, ?, 1" + (tcol ? ", 1" : "") + ") " +
      "ON CONFLICT(day, tier) DO UPDATE SET " + sets.join(", ")
    ).bind(day, tier, f, fl)).concat([db.prepare("DELETE FROM loom_seen WHERE day < ?").bind(day - 7)]));
  } else {
    const was = await db.prepare("SELECT lv, cc FROM loom_seen WHERE day = ? AND id = ?").bind(day, id).first();
    if (was && Number.isInteger(was.lv) && level > was.lv) {
      /* A climb that had lost nothing yet cannot have been "lost"; one that was
         counted as lost (a level 0 sent at its end) and now says more is a phone
         an hour either side of midnight, and is moved like any other. */
      const fl = fresh && was.lv === 0 ? ", flost = flost - 1" : "";
      await db.batch(tiers(was.cc).map((tier) => db.prepare(
        "UPDATE loom_result SET " + col(was.lv) + " = " + col(was.lv) + " - 1, " +
        col(level) + " = " + col(level) + " + 1" + fl + " WHERE day = ? AND tier = ?"
      ).bind(day, tier)).concat([db.prepare("UPDATE loom_seen SET lv = ? WHERE day = ? AND id = ?").bind(level, day, id)]));
    }
  }
  return ladderReply(db, day, cc);
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return preflight();
  /* A D1 binding, not a text variable called LOOM: a variable would arrive here
     as the string "loom", pass a plain truthiness check, and then throw on the
     first query, which reads as a broken endpoint rather than a missing one. */
  if (!env.LOOM || typeof env.LOOM.prepare !== "function") {
    return json({ error: "no store: bind a D1 database as LOOM" }, 503);
  }

  const url = new URL(request.url);
  const now = today();

  if (request.method === "GET") {
    const day = parseInt(url.searchParams.get("d"), 10);
    const loom = loomOf(url.searchParams.get("l"));
    if (!Number.isFinite(day) || day < 0 || day > now) return json({ error: "day" }, 400);
    if (loom === undefined) return json({ error: "loom" }, 400);
    if (loom === "L") return json(await ladderReply(env.LOOM, day, countryOf(request)));
    return json(shape(await readDay(env.LOOM, day, loom)));
  }

  if (request.method !== "POST") return new Response(null, { status: 405 });

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "body" }, 400); }

  const day = parseInt(body.d, 10);
  const attempts = parseInt(body.a, 10);          // 0 means the day was not solved
  const seconds = parseInt(body.s, 10);
  const key = typeof body.k === "string" ? body.k.slice(0, 64) : "";
  /* The day this phone first opened Loom, when it says. Only used to ask one
     thing: was this result a first day? A new player's day is counted a second
     time in loom_fresh, so a first day can be told from a returning one. */
  const firstDay = parseInt(body.f, 10);
  const loom = loomOf(body.l);

  /* Yesterday, today and tomorrow only: a phone an hour either side of UTC is
     honest, a result for day 4000 is not. */
  if (!Number.isFinite(day) || day < now - 1 || day > now + 1) return json({ error: "day" }, 400);
  if (!Number.isFinite(attempts) || attempts < 0 || attempts > MAXTRIES) return json({ error: "attempts" }, 400);
  if (!key || key.length < 8) return json({ error: "key" }, 400);
  if (loom === undefined) return json({ error: "loom" }, 400);

  const db = env.LOOM;
  /* One result per phone per loom: the loom is inside the hash, so Easy and
     Hard from one phone on one day are two results, and a retry of either is
     still one. A result with no loom hashes exactly as it always did. */
  const id = await seenId(loom ? day + loom : day, key);

  if (loom === "L") return json(await climb(db, day, id, attempts, seconds, firstDay === day, countryOf(request)));

  /* INSERT OR IGNORE is the whole of the double-count guard: the first result
     for a phone on a day inserts a row and counts; a retry inserts nothing and
     only reads. meta.changes tells the two apart without a second query. */
  const seen = await db.prepare("INSERT OR IGNORE INTO loom_seen (day, id) VALUES (?, ?)").bind(day, id).run();
  const first = !!(seen.meta && seen.meta.changes);

  if (first && loom) {
    const col = attempts === 0 ? "lost" : "c" + attempts;
    const good = attempts > 0 && Number.isFinite(seconds) && seconds >= 3 && seconds <= 7200;
    const tcol = good ? "t" + band(seconds) : null;
    const fresh = firstDay === day ? 1 : 0, flost = fresh && attempts === 0 ? 1 : 0;
    const sets = ["total = total + 1", col + " = " + col + " + 1",
                  "fresh = fresh + " + fresh, "flost = flost + " + flost];
    if (tcol) sets.push(tcol + " = " + tcol + " + 1");
    await db.prepare(
      "INSERT INTO loom_result (day, tier, total, fresh, flost, " + col + (tcol ? ", " + tcol : "") + ") " +
      "VALUES (?, ?, 1, ?, ?, 1" + (tcol ? ", 1" : "") + ") " +
      "ON CONFLICT(day, tier) DO UPDATE SET " + sets.join(", ")
    ).bind(day, loom, fresh, flost).run();
    await db.prepare("DELETE FROM loom_seen WHERE day < ?").bind(day - 7).run();
  } else if (first) {
    const col = attempts === 0 ? "lost" : "c" + Math.min(attempts, 6);
    /* A time band is only counted for a day that was solved and carries a
       plausible time; a missing or absurd one costs the day nothing else. */
    const good = attempts > 0 && Number.isFinite(seconds) && seconds >= 3 && seconds <= 7200;
    const tcol = good ? "t" + band(seconds) : null;
    const sets = ["total = total + 1", col + " = " + col + " + 1"];
    if (tcol) sets.push(tcol + " = " + tcol + " + 1");
    await db.prepare(
      "INSERT INTO loom_day (day, total, " + col + (tcol ? ", " + tcol : "") + ") VALUES (?, 1, 1" + (tcol ? ", 1" : "") + ") " +
      "ON CONFLICT(day) DO UPDATE SET " + sets.join(", ")
    ).bind(day).run();
    if (firstDay === day) {
      const lost = attempts === 0 ? 1 : 0;
      await db.prepare(
        "INSERT INTO loom_fresh (day, total, lost) VALUES (?, 1, ?) " +
        "ON CONFLICT(day) DO UPDATE SET total = total + 1, lost = lost + ?"
      ).bind(day, lost, lost).run();
    }
    /* A week is long enough for a phone that has been in a drawer, and short
       enough that this table never becomes a history of anything. */
    await db.prepare("DELETE FROM loom_seen WHERE day < ?").bind(day - 7).run();
  }

  const row = await readDay(db, day, loom);
  /* "You are the seventh to solve today's cloth": everybody who has solved it,
     this phone included, at the moment this result arrived. */
  const solvedSoFar = row.c1 + row.c2 + row.c3 + row.c4 + row.c5 + row.c6 + (row.c7 || 0) + (row.c8 || 0);
  return json(shape(row, attempts > 0 ? solvedSoFar : undefined));
}
