/* Voltix Analytics — /va/device/enrol: registers the VA app's fingerprint key
   (functions/_va/device.js). Only inside a session opened with the password and
   code in the last ten minutes, so a session cookie found later cannot add a
   phone; at most MAX_DEVICES phones. Answers the new device's id. */

import { sessionStart } from "../../_va/lib.js";
import { importKey, newDeviceId, jsonAnswer, ENROL_FRESH_MS, MAX_DEVICES } from "../../_va/device.js";

export async function onRequestPost({ request, env }) {
  if (!env.VA) return jsonAnswer({ error: "setup" }, 503);
  const now = Date.now();
  const began = await sessionStart(request, env, now);
  if (!began) return jsonAnswer({ error: "login" }, 401);
  if (now - began > ENROL_FRESH_MS) return jsonAnswer({ error: "stale" }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return jsonAnswer({ error: "body" }, 400); }
  if (!body || !(await importKey(body.pubkey))) return jsonAnswer({ error: "key" }, 400);
  const name = typeof body.name === "string" ? body.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 64) : null;

  const db = env.VA;
  const n = await db.prepare("SELECT COUNT(*) AS n FROM va_device").first();
  if (n && n.n >= MAX_DEVICES) return jsonAnswer({ error: "full" }, 409);
  const id = newDeviceId();
  await db.prepare("INSERT INTO va_device (id, name, pubkey, created, last_exp) VALUES (?, ?, ?, ?, 0)")
    .bind(id, name, body.pubkey, now).run();
  return jsonAnswer({ id });
}
