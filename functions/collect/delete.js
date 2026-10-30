/* Voltix Analytics — a player's deletion, at /collect/delete (D-074).
 *
 * The game's analytics switch and legal/<game>/delete-account.html post
 * { g: game, i: install id } here, and every row VA holds for that install is
 * deleted on the spot. The install id is a random number only that phone
 * knows, which is what makes it safe to accept without an account: nobody can
 * delete a player they cannot name.
 *
 * What is kept afterwards is a count of deletions per day and game, never
 * whose. Summaries already added together (players per day, retention) keep
 * the player inside their totals, which hold no identifier.
 *
 * Every table with an `install` column is listed in TABLES; a new one goes
 * here the day it is created.
 */

import { GAMES } from "../_va/games.js";
import { vaDay } from "../_va/lib.js";

const TABLES = ["va_batch", "va_install", "va_purchase", "va_session", "va_daily_user", "va_day_result"];

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

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: CORS });
  if (!env.VA || typeof env.VA.prepare !== "function") return json({ error: "no store: bind a D1 database as VA" }, 503);

  let b;
  try { b = JSON.parse((await request.text()).slice(0, 2048)); } catch (e) { return json({ error: "body" }, 400); }
  const game = b && typeof b.g === "string" && Object.prototype.hasOwnProperty.call(GAMES, b.g) ? b.g : null;
  if (!game) return json({ error: "game" }, 400);
  if (typeof b.i !== "string" || !/^[A-Za-z0-9-]{12,64}$/.test(b.i)) return json({ error: "install" }, 400);

  const db = env.VA;
  try {
    const res = await db.batch(TABLES.map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE game = ? AND install = ?`).bind(game, b.i)));
    const deleted = res.reduce((n, r) => n + ((r.meta && r.meta.changes) || 0), 0);
    if (deleted) {
      await db.prepare(
        "INSERT INTO va_deleted (day, game, n) VALUES (?, ?, 1) ON CONFLICT (day, game) DO UPDATE SET n = n + 1"
      ).bind(vaDay(), game).run();
    }
    return json({ ok: true, deleted });
  } catch (e) {
    return json({ error: "store" }, 503);
  }
}
