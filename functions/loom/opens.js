/* Voltix Studios — Loom's open counter.
 *
 * A Cloudflare Pages Function beside scores.js, answering at /loom/opens.
 *
 * What it is for: /loom/scores only ever hears from a phone that finished the
 * day, so it cannot say how many people opened the game, how many gave up
 * before the end, or whether anybody came back. This answers those three, and
 * nothing else.
 *
 * WHAT IS STORED, in full. One count per day opened, per day the phone first
 * opened Loom, per gap since the phone last opened it: "of the phones that
 * started on day F, N opened day D, and had last opened Loom G days before".
 * Counts, not people. From that one table come:
 *   - the players of a day: every row for D;
 *   - the new players of a day: G = 0, which is F = D;
 *   - the return of every cohort, on every day after it started: rows F, D;
 *   - unique players over any run of days, which a sum of daily players is
 *     not: a phone is counted on the first day it opened inside the run, and
 *     that is the day whose gap reaches back past the run's first day.
 * G is -1 when the phone did not say (versionCode 25 sent no last day).
 *
 * The phone sends four things: the day it is opening, the day it first opened
 * Loom, the last day before this one that it opened Loom, and the same made-up
 * number scores.js receives, so a retry is not counted twice. The number is
 * hashed with the day and with a letter that scores.js does not use, so an
 * open and a result from one phone cannot be tied to each other, and two days
 * from one phone cannot either. Those rows are deleted after a week, as there.
 *
 * Needs the same D1 binding, LOOM. The tables are in schema.sql.
 */

const DAY0 = Date.UTC(2026, 0, 1);              // Loom counts days from here

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });

/* A null body, never {}: 204 is a null-body status, and a body here throws in
   the Workers runtime and fails the preflight (see scores.js). */
const preflight = () => new Response(null, { status: 204, headers: CORS });

const today = () => Math.floor((Date.now() - DAY0) / 86400000);

async function seenId(day, key) {
  const bytes = new TextEncoder().encode("o" + day + ":" + key);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return preflight();
  if (!env.LOOM || typeof env.LOOM.prepare !== "function") {
    return json({ error: "no store: bind a D1 database as LOOM" }, 503);
  }
  if (request.method !== "POST") return new Response(null, { status: 405 });

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "body" }, 400); }

  const now = today();
  const day = parseInt(body.d, 10);
  const first = parseInt(body.f, 10);
  const key = typeof body.k === "string" ? body.k.slice(0, 64) : "";
  const last = parseInt(body.p, 10);

  if (!Number.isFinite(day) || day < now - 1 || day > now + 1) return json({ error: "day" }, 400);
  /* A first day after the day being opened is a clock that moved back; one
     before Loom existed is a fault. Neither is a cohort. */
  if (!Number.isFinite(first) || first < 0 || first > day) return json({ error: "first" }, 400);
  if (!key || key.length < 8) return json({ error: "key" }, 400);
  /* The gap since the last open. A first day has none; a last day that is not
     between the first day and this one is a clock that moved, and is unknown
     rather than refused, because the open itself is still true. */
  const gap = first === day ? 0
    : Number.isFinite(last) && last >= first && last < day ? Math.min(day - last, 99999) : -1;

  const db = env.LOOM;
  const seen = await db.prepare("INSERT OR IGNORE INTO loom_seen (day, id) VALUES (?, ?)")
    .bind(day, await seenId(day, key)).run();
  const counted = !!(seen.meta && seen.meta.changes);

  if (counted) {
    await db.prepare(
      "INSERT INTO loom_open (first, day, gap, n) VALUES (?, ?, ?, 1) " +
      "ON CONFLICT(first, day, gap) DO UPDATE SET n = n + 1"
    ).bind(first, day, gap).run();
    await db.prepare("DELETE FROM loom_seen WHERE day < ?").bind(day - 7).run();
  }
  return json({ ok: true, counted });
}
