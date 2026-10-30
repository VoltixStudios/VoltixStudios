/* Voltix Analytics — the login, at /va/login (D-072).
 *
 * A password and a six-digit authenticator code, both required. This takes
 * the place of Cloudflare Access, which asks for a payment method; the studio
 * spends nothing on this (brief of 29 October 2026).
 *
 * Against guessing: five failed attempts from one address, or twenty from
 * everywhere, inside fifteen minutes, lock the login until the oldest of them
 * is fifteen minutes old. An authenticator code is accepted once only. Every
 * attempt is written to va_login (the address as a keyed hash, never itself)
 * and deleted after a day.
 *
 * Secrets: VA_PASS_HASH, VA_TOTP_SEED, VA_COOKIE_KEY (see SETUP.md). D1: VA.
 */

import { passwordOk, totpStep, sessionCookie, signedIn, whoHash } from "../_va/lib.js";

const LOCK_MS = 15 * 60 * 1000;
const MAX_MINE = 5;
const MAX_ALL = 20;

function page(message, status = 200, extra = {}) {
  const note = message ? `<p class="note">${message}</p>` : "";
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Voltix Analytics</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f5f2; --fg:#1d1d1f; --muted:#6b6b70; --line:#d9d7d2; --accent:#3d5afe; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141416; --fg:#ececef; --muted:#9a9aa2; --line:#2e2e33; --accent:#8c9eff; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg);
         font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding:16px; }
  form { width:100%; max-width:320px; display:grid; gap:12px; }
  h1 { font-size:20px; margin:0 0 8px; }
  label { display:grid; gap:4px; font-size:14px; color:var(--muted); }
  input { font:inherit; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--fg); }
  button { font:inherit; padding:10px 12px; border:0; border-radius:8px; background:var(--accent); color:#fff; cursor:pointer; }
  .note { margin:0; font-size:14px; color:var(--muted); }
</style></head>
<body><form method="post" action="/va/login">
  <h1>Voltix Analytics</h1>
  ${note}
  <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
  <label>Authenticator code <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>
  <button type="submit">Sign in</button>
</form></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...extra } });
}

export async function onRequestGet({ request, env }) {
  if (await signedIn(request, env)) return new Response(null, { status: 302, headers: { Location: "/va/" } });
  return page("");
}

export async function onRequestPost({ request, env }) {
  if (!env.VA || !env.VA_PASS_HASH || !env.VA_TOTP_SEED || !env.VA_COOKIE_KEY) {
    return page("Not set up yet: the database or a secret is missing. See functions/va/SETUP.md.", 503);
  }
  const db = env.VA;
  const now = Date.now();
  const who = await whoHash(request, env);

  const recent = await db.prepare(
    "SELECT COUNT(*) AS everyone, SUM(CASE WHEN who = ? THEN 1 ELSE 0 END) AS mine FROM va_login WHERE ok = 0 AND at > ?"
  ).bind(who, now - LOCK_MS).first();
  if ((recent && (recent.mine || 0) >= MAX_MINE) || (recent && recent.everyone >= MAX_ALL)) {
    return page("Too many failed attempts. Wait fifteen minutes and try again.", 429);
  }

  let form;
  try { form = await request.formData(); } catch (e) { return page("Wrong password or code.", 400); }
  const password = String(form.get("password") || "").slice(0, 200);
  const code = String(form.get("code") || "").trim();

  /* Both are worked out every time, so a wrong password takes as long as a
     wrong code. */
  const passOk = await passwordOk(password, env.VA_PASS_HASH);
  const step = await totpStep(env.VA_TOTP_SEED, code, now);
  const last = await db.prepare("SELECT v FROM va_meta WHERE k = 'totp_last'").first();
  const ok = passOk && step >= 0 && step > parseInt((last && last.v) || "-1", 10);

  const writes = [
    db.prepare("INSERT INTO va_login (at, who, ok) VALUES (?, ?, ?)").bind(now, who, ok ? 1 : 0),
    db.prepare("DELETE FROM va_login WHERE at < ?").bind(now - 86400000),
  ];
  if (ok) {
    writes.push(db.prepare(
      "INSERT INTO va_meta (k, v) VALUES ('totp_last', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v"
    ).bind(String(step)));
  }
  await db.batch(writes);

  if (!ok) return page("Wrong password or code.", 401);
  return new Response(null, {
    status: 303,
    headers: { Location: "/va/", "Set-Cookie": await sessionCookie(env, now) },
  });
}
