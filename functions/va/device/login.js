/* Voltix Analytics — /va/device/login: the VA app's fingerprint sign-in
   (functions/_va/device.js). The app sends its device id, a challenge from
   /va/device/challenge and the challenge signed with its key; a good signature
   opens the same twelve-hour session as the password and code.

   Shares the password login's guard: every attempt is written to va_login and
   the same five-from-one-address or twenty-from-everywhere in fifteen minutes
   locks both ways in. An unknown device answers "unknown", so the app forgets a
   key that has been removed here. */

import { sessionCookie, whoHash } from "../../_va/lib.js";
import { challengeExp, importKey, signatureOk, jsonAnswer } from "../../_va/device.js";

const LOCK_MS = 15 * 60 * 1000;
const MAX_MINE = 5;
const MAX_ALL = 20;

export async function onRequestPost({ request, env }) {
  if (!env.VA || !env.VA_COOKIE_KEY) return jsonAnswer({ error: "setup" }, 503);
  const db = env.VA;
  const now = Date.now();
  const who = await whoHash(request, env);

  const recent = await db.prepare(
    "SELECT COUNT(*) AS everyone, SUM(CASE WHEN who = ? THEN 1 ELSE 0 END) AS mine FROM va_login WHERE ok = 0 AND at > ?"
  ).bind(who, now - LOCK_MS).first();
  if ((recent && (recent.mine || 0) >= MAX_MINE) || (recent && recent.everyone >= MAX_ALL)) {
    return jsonAnswer({ error: "locked" }, 429);
  }

  let body = null;
  try { body = await request.json(); } catch (e) { /* counted as a failure below */ }
  const id = body && typeof body.id === "string" && body.id.length <= 64 ? body.id : "";
  const device = id ? await db.prepare("SELECT pubkey, last_exp FROM va_device WHERE id = ?").bind(id).first() : null;
  const exp = body ? await challengeExp(env, body.challenge, now) : 0;
  const key = device ? await importKey(device.pubkey) : null;
  const ok = !!(device && key && exp && exp > device.last_exp && (await signatureOk(key, body.challenge, body.sig)));

  const writes = [
    db.prepare("INSERT INTO va_login (at, who, ok) VALUES (?, ?, ?)").bind(now, who, ok ? 1 : 0),
    db.prepare("DELETE FROM va_login WHERE at < ?").bind(now - 86400000),
  ];
  if (ok) writes.push(db.prepare("UPDATE va_device SET last_exp = ?, last_used = ? WHERE id = ?").bind(exp, now, id));
  await db.batch(writes);

  if (!device) return jsonAnswer({ error: "unknown" }, 401);
  if (!ok) return jsonAnswer({ error: exp ? "signature" : "challenge" }, 401);
  return jsonAnswer({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, now) });
}
