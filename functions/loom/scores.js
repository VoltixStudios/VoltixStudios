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
 * order of operations, and no row that belongs to anybody.
 *
 * The one thing that is per-device is a check against counting the same phone
 * twice — a network retry would otherwise count a day twice and skew the very
 * numbers this exists to report. The phone makes up a random number once, keeps
 * it to itself, and sends it; what is stored is sha256(day + ':' + number),
 * never the number. Because the day is inside the hash and the number has 96
 * bits in it, two days' hashes from one phone cannot be tied to each other by
 * anybody holding this table. Those rows are deleted after a week.
 *
 * Needs a D1 binding called LOOM. The schema is in schema.sql beside this file.
 */

const DAY0 = Date.UTC(2026, 0, 1);              // Loom counts days from here
const MAXTRIES = 6;
/* Six time bands, in seconds. A band rather than a time because a distribution
   of exact times is a fingerprint and a histogram of bands is not. */
const BANDS = [30, 60, 120, 240, 480];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      /* The game runs from file:// inside a WebView, so its origin is "null".
         There is nothing here to protect with an origin check: the endpoint
         holds no secrets, sets no cookie and answers the same to everyone. */
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });

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
  n: row.total,
  solved: [row.c1, row.c2, row.c3, row.c4, row.c5, row.c6],
  lost: row.lost,
  t: [row.t1, row.t2, row.t3, row.t4, row.t5, row.t6],
  bands: BANDS,
  ...(rank === undefined ? {} : { rank }),
});

async function readDay(db, day) {
  const row = await db.prepare("SELECT * FROM loom_day WHERE day = ?").bind(day).first();
  return row || { day, total: 0, lost: 0, c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0,
                  t1: 0, t2: 0, t3: 0, t4: 0, t5: 0, t6: 0 };
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return json({}, 204);
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
    if (!Number.isFinite(day) || day < 0 || day > now) return json({ error: "day" }, 400);
    return json(shape(await readDay(env.LOOM, day)));
  }

  if (request.method !== "POST") return new Response(null, { status: 405 });

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "body" }, 400); }

  const day = parseInt(body.d, 10);
  const attempts = parseInt(body.a, 10);          // 0 means the day was not solved
  const seconds = parseInt(body.s, 10);
  const key = typeof body.k === "string" ? body.k.slice(0, 64) : "";

  /* Yesterday, today and tomorrow only: a phone an hour either side of UTC is
     honest, a result for day 4000 is not. */
  if (!Number.isFinite(day) || day < now - 1 || day > now + 1) return json({ error: "day" }, 400);
  if (!Number.isFinite(attempts) || attempts < 0 || attempts > MAXTRIES) return json({ error: "attempts" }, 400);
  if (!key || key.length < 8) return json({ error: "key" }, 400);

  const db = env.LOOM;
  const id = await seenId(day, key);

  /* INSERT OR IGNORE is the whole of the double-count guard: the first result
     for a phone on a day inserts a row and counts; a retry inserts nothing and
     only reads. meta.changes tells the two apart without a second query. */
  const seen = await db.prepare("INSERT OR IGNORE INTO loom_seen (day, id) VALUES (?, ?)").bind(day, id).run();
  const first = !!(seen.meta && seen.meta.changes);

  if (first) {
    const col = attempts === 0 ? "lost" : "c" + attempts;
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
    /* A week is long enough for a phone that has been in a drawer, and short
       enough that this table never becomes a history of anything. */
    await db.prepare("DELETE FROM loom_seen WHERE day < ?").bind(day - 7).run();
  }

  const row = await readDay(db, day);
  /* "You are the seventh to solve today's cloth": everybody who has solved it,
     this phone included, at the moment this result arrived. */
  const solvedSoFar = row.c1 + row.c2 + row.c3 + row.c4 + row.c5 + row.c6;
  return json(shape(row, attempts > 0 ? solvedSoFar : undefined));
}
