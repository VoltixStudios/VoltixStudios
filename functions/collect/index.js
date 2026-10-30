/* Voltix Analytics — the collector, at /collect (D-072).
 *
 * The games post batches of events here; this checks every field against the
 * rules below, keeps what passes, and writes one row per batch to D1. It is
 * public by necessity — a game on a phone has no secret worth the name — so it
 * trusts nothing it is sent.
 *
 * A BATCH, as the game sends it (JSON, at most 64 KB):
 *   v    1
 *   g    the game: a key of GAMES in functions/_va/games.js
 *   i    the install id the game made up for itself (Loom's voltix.cid)
 *   p    'app', or 'web' for a copy played on the site
 *   vc   version code
 *   fd   the game's own first day for this install, days since 1 January 2026
 *   e    up to 50 events: { n name, t client ms, s session, q sequence,
 *        d game day, x params, u user properties }
 *   src  optional, once: { source, medium, campaign } from the install referrer
 *   dev  optional, once per version: { model, os, webview, lang, screen }
 *   pur  optional: [{ data, sig, price_micros, currency }] — Play's signed
 *        purchase JSON and its signature, checked here against the licence key
 *
 * THE RULES. An event whose name the game is not allowed is refused and
 * counted. A param must be a short snake_case name holding a number, a short
 * string or a true/false; at most 25 per event. User properties must be on the
 * game's list. A client time or game day outside the last five days is
 * dropped, not trusted. One install may send at most CAP events a day. The
 * address is never written: only the country Cloudflare already worked out.
 *
 * ANSWERS. 200 { ok, kept, refused } — the game deletes the batch. 400 — the
 * batch can never be accepted; the game deletes it too. 429 — this install sent
 * too much today; delete. 503 — not stored for a reason on this side (no
 * database, switched off, a limit reached); the game keeps the batch and tries
 * again later, as it does offline.
 *
 * Needs the D1 binding VA (functions/va/schema.sql). VA_OFF=1 switches it off.
 */

import { GAMES } from "../_va/games.js";
import { vaDay, sha256hex, unb64 } from "../_va/lib.js";

const MAX_BODY = 64 * 1024;
const MAX_EVENTS = 50;
const MAX_PARAMS = 25;
const CAP = 3000;                                // events per install per day
const WINDOW = 5 * 86400000;                     // how far back a queued event may be

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

/* A null body: 204 is a null-body status, and a body here throws in the
   Workers runtime and fails the preflight (see functions/loom/scores.js). */
const preflight = () => new Response(null, { status: 204, headers: CORS });

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const ID = /^[A-Za-z0-9-]{12,64}$/;

/* A short plain string: no control characters, at most `max` long. */
function text(v, max = 100) {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return s || null;
}

function value(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return text(v) ?? undefined;
  return undefined;
}

function params(obj, allowed) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  const out = {};
  let k = 0;
  for (const [key, v] of Object.entries(obj)) {
    if (k >= MAX_PARAMS) break;
    if (!NAME.test(key) || (allowed && !allowed.has(key))) continue;
    const c = value(v);
    if (c === undefined) continue;
    out[key] = c;
    k++;
  }
  return k ? out : undefined;
}

function int(v, lo, hi) {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

/* Google's signature over the purchase JSON, RSA with SHA-1 as Play signs it,
   the same check Loom's Receipt.java makes on the phone. */
async function genuine(keyB64, data, sig) {
  try {
    const key = await crypto.subtle.importKey("spki", unb64(keyB64),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" }, false, ["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
      unb64(sig.replace(/\s/g, "")), new TextEncoder().encode(data));
  } catch (e) {
    return false;
  }
}

async function purchases(list, game, gameKey, install, env, now) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list.slice(0, 5)) {
    if (!p || typeof p.data !== "string" || typeof p.sig !== "string" || p.data.length > 4000 || p.sig.length > 1000) continue;
    let d;
    try { d = JSON.parse(p.data); } catch (e) { continue; }
    if (!d || typeof d !== "object") continue;
    const key = env["VA_LICENCE_" + gameKey.toUpperCase()] || game.licence;
    const ok = d.packageName === game.pkg && (await genuine(key, p.data, p.sig));
    const id = text(d.orderId, 64) || (typeof d.purchaseToken === "string" ? "t:" + (await sha256hex(d.purchaseToken)) : null);
    if (!id) continue;
    out.push({
      id,
      sku: text(d.productId || (Array.isArray(d.productIds) ? d.productIds[0] : null), 64),
      price: int(p.price_micros, 0, 1e12),
      currency: typeof p.currency === "string" && /^[A-Z]{3}$/.test(p.currency) ? p.currency : null,
      time: int(d.purchaseTime, 0, now + 86400000),
      verified: ok ? 1 : 0,
    });
  }
  return out;
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "POST") return new Response(null, { status: 405, headers: CORS });
  if (env.VA_OFF === "1") return json({ error: "off" }, 503);
  if (!env.VA || typeof env.VA.prepare !== "function") return json({ error: "no store: bind a D1 database as VA" }, 503);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: "size" }, 400);
  let b;
  try { b = JSON.parse(raw); } catch (e) { return json({ error: "body" }, 400); }
  if (!b || typeof b !== "object" || b.v !== 1) return json({ error: "version" }, 400);

  const gameKey = typeof b.g === "string" ? b.g : "";
  const game = Object.prototype.hasOwnProperty.call(GAMES, gameKey) ? GAMES[gameKey] : null;
  if (!game) return json({ error: "game" }, 400);
  if (typeof b.i !== "string" || !ID.test(b.i)) return json({ error: "install" }, 400);
  if (b.p !== "app" && b.p !== "web") return json({ error: "platform" }, 400);
  if (!Array.isArray(b.e) || b.e.length > MAX_EVENTS) return json({ error: "events" }, 400);

  const now = Date.now();
  const day = vaDay(now);
  const vc = int(b.vc, 0, 1e7);
  const firstDay = int(b.fd, 0, day + 1);

  const kept = [];
  let refused = 0;
  for (const e of b.e) {
    if (!e || typeof e !== "object" || typeof e.n !== "string" || !game.events.has(e.n)) { refused++; continue; }
    const ev = { n: e.n };
    const t = int(e.t, now - WINDOW, now + 86400000);
    if (t !== null) ev.t = t;
    const s = text(typeof e.s === "number" ? String(e.s) : e.s, 32);
    if (s) ev.s = s;
    const q = int(e.q, 0, 1e9);
    if (q !== null) ev.q = q;
    const d = int(e.d, day - 5, day + 1);
    if (d !== null) ev.d = d;
    const x = params(e.x);
    if (x) ev.x = x;
    const u = params(e.u, game.props);
    if (u) ev.u = u;
    kept.push(ev);
  }

  const src = b.src && typeof b.src === "object" ? b.src : {};
  const dev = b.dev && typeof b.dev === "object" ? b.dev : {};
  const pur = await purchases(b.pur, game, gameKey, b.i, env, now);
  if (!kept.length && !refused && !pur.length) return json({ ok: true, kept: 0, refused: 0 });

  const db = env.VA;
  const total = kept.length + refused;
  try {
    const prior = await db.prepare("SELECT cap_day, cap_n FROM va_install WHERE game = ? AND install = ?")
      .bind(gameKey, b.i).first();
    if (prior && prior.cap_day === day && prior.cap_n + total > CAP) return json({ error: "cap" }, 429);

    const cf = request.cf || {};
    const country = typeof cf.country === "string" && /^[A-Z]{2}$/.test(cf.country) ? cf.country : null;
    const writes = [
      db.prepare(
        `INSERT INTO va_install (game, install, platform, first_seen, first_day, last_seen, vc_first, vc_last,
           country, src_source, src_medium, src_campaign, dev_model, dev_os, dev_webview, dev_lang, dev_screen,
           batches, events, cap_day, cap_n)
         VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 1, ?16, ?17, ?18)
         ON CONFLICT (game, install) DO UPDATE SET
           last_seen = ?4,
           first_day = COALESCE(va_install.first_day, excluded.first_day),
           vc_last = COALESCE(excluded.vc_last, va_install.vc_last),
           country = COALESCE(excluded.country, va_install.country),
           src_source = COALESCE(va_install.src_source, excluded.src_source),
           src_medium = COALESCE(va_install.src_medium, excluded.src_medium),
           src_campaign = COALESCE(va_install.src_campaign, excluded.src_campaign),
           dev_model = COALESCE(excluded.dev_model, va_install.dev_model),
           dev_os = COALESCE(excluded.dev_os, va_install.dev_os),
           dev_webview = COALESCE(excluded.dev_webview, va_install.dev_webview),
           dev_lang = COALESCE(excluded.dev_lang, va_install.dev_lang),
           dev_screen = COALESCE(excluded.dev_screen, va_install.dev_screen),
           batches = va_install.batches + 1,
           events = va_install.events + ?16,
           cap_n = CASE WHEN va_install.cap_day = ?17 THEN va_install.cap_n + ?18 ELSE ?18 END,
           cap_day = ?17`
      ).bind(gameKey, b.i, b.p, now, firstDay, vc, country,
        text(src.source, 64), text(src.medium, 64), text(src.campaign, 100),
        text(dev.model, 64), text(dev.os, 32), text(dev.webview, 32), text(dev.lang, 16), text(dev.screen, 16),
        kept.length, day, total),
    ];
    if (total) {
      writes.push(db.prepare(
        "INSERT INTO va_batch (game, install, platform, vc, day, received, country, n, refused, events) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(gameKey, b.i, b.p, vc, day, now, country, kept.length, refused, JSON.stringify(kept)));
    }
    for (const p of pur) {
      writes.push(db.prepare(
        `INSERT INTO va_purchase (id, game, install, sku, price_micros, currency, purchase_time, verified, received)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET verified = MAX(verified, excluded.verified)`
      ).bind(p.id, gameKey, b.i, p.sku, p.price, p.currency, p.time, p.verified, now));
    }
    await db.batch(writes);
  } catch (e) {
    /* A free-plan limit reached, or D1 away: not the game's fault, and not
       lost — it keeps the batch and sends it again later. */
    return json({ error: "store" }, 503);
  }
  return json({ ok: true, kept: kept.length, refused, purchases: pur.length });
}
