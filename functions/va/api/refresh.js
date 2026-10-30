/* Voltix Analytics — the dashboard's "Refresh now" button, at POST /va/api/refresh.
 *
 * Runs the same summary as the scheduled runs at 08:00 and 22:00 Spanish time
 * (workers/va-nightly), on demand, behind the login (the middleware refuses
 * this without a session cookie). The work is the same SQL, run inside D1, so
 * it costs this Function almost no CPU.
 *
 * Kept within the free plan: a summary rewrites four days of tables, so the
 * button refuses if any summary (scheduled or manual) ran in the last
 * MIN_GAP_MIN minutes, and allows MAX_PER_DAY manual runs a day (UTC). A POST
 * from any other site is refused, besides the cookie's own SameSite=Strict.
 */

import { nightly } from "../../../workers/va-nightly/src/index.js";
import { vaDay } from "../../_va/lib.js";

const MIN_GAP_MIN = 10;
const MAX_PER_DAY = 8;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function onRequestPost({ request, env }) {
  if (!env.VA) return json({ error: "no store" }, 503);
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "origin" }, 403);

  const db = env.VA;
  const now = Date.now();
  const last = await db.prepare("SELECT v FROM va_meta WHERE k = 'nightly_last'").first();
  const lastAt = last && last.v ? Date.parse(JSON.parse(last.v).at) : 0;
  if (lastAt && now - lastAt < MIN_GAP_MIN * 60000) {
    return json({ error: "recent", at: new Date(lastAt).toISOString(),
                  wait_min: Math.ceil((MIN_GAP_MIN * 60000 - (now - lastAt)) / 60000) }, 429);
  }
  const count = await db.prepare("SELECT v FROM va_meta WHERE k = 'manual_refresh'").first();
  const c = count && count.v ? JSON.parse(count.v) : {};
  const used = c.day === vaDay(now) ? c.n || 0 : 0;
  if (used >= MAX_PER_DAY) return json({ error: "limit", max: MAX_PER_DAY }, 429);

  await db.prepare("INSERT INTO va_meta (k, v) VALUES ('manual_refresh', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v")
    .bind(JSON.stringify({ day: vaDay(now), n: used + 1 })).run();
  try {
    const note = await nightly(env, now, "manual");
    return json({ ok: true, summary: note, left_today: MAX_PER_DAY - used - 1 });
  } catch (e) {
    return json({ error: "summary", detail: String(e && e.message || e).slice(0, 200) }, 500);
  }
}
