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
<meta name="theme-color" content="#05060a">
<title>Voltix Analytics</title>
<link rel="icon" href="/assets/img/favicon-32.png" sizes="32x32">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Inter:wght@400;500;600&display=swap">
<style>
  :root { color-scheme:dark; --ink:#05060a; --ink-1:#090b12; --ink-2:#0e111a; --line:rgba(255,255,255,.09);
          --text:#e9edf6; --muted:#8792a8; --volt:#35a3ff; --volt-2:#a06bff;
          --display:"Chakra Petch","Segoe UI Semibold",system-ui,sans-serif; --body:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:16px; color:var(--text);
         font:400 15px/1.5 var(--body); -webkit-font-smoothing:antialiased;
         background:radial-gradient(800px 420px at 80% -10%, color-mix(in srgb, var(--volt-2) 22%, transparent), transparent 70%),
                    radial-gradient(700px 400px at 10% 110%, color-mix(in srgb, var(--volt) 18%, transparent), transparent 70%), var(--ink); }
  form { width:100%; max-width:340px; display:grid; gap:14px; padding:28px 26px; border:1px solid var(--line); border-radius:18px;
         background:linear-gradient(180deg, var(--ink-2), var(--ink-1)); box-shadow:0 30px 80px -30px color-mix(in srgb, var(--volt) 35%, transparent); }
  .brand { display:flex; align-items:center; gap:11px; margin-bottom:6px; }
  .brand img { width:38px; height:38px; }
  .brand span { font-family:var(--display); font-weight:700; letter-spacing:.04em; text-transform:uppercase; line-height:1.15; }
  .brand em { display:block; font-style:normal; font-weight:500; color:var(--muted); letter-spacing:.18em; font-size:.68em; }
  label { display:grid; gap:6px; font-family:var(--display); font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  input { font:inherit; font-family:var(--body); font-size:15px; letter-spacing:0; text-transform:none; padding:11px 12px;
          border:1px solid var(--line); border-radius:10px; background:var(--ink); color:var(--text); }
  input:focus { outline:2px solid var(--volt); outline-offset:1px; }
  button { font-family:var(--display); font-weight:600; font-size:15px; letter-spacing:.03em; padding:12px; border:0; border-radius:999px; cursor:pointer;
           color:#05070e; background:linear-gradient(100deg, var(--volt), var(--volt-2)); box-shadow:0 8px 30px -10px color-mix(in srgb, var(--volt) 70%, transparent); }
  .note { margin:0; font-size:14px; color:#ffd29a; }
</style></head>
<body><form method="post" action="/va/login">
  <div class="brand"><img src="/assets/img/voltix-mark.webp" alt="" width="38" height="38"><span>Voltix<em>Analytics</em></span></div>
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
