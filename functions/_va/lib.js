/* Voltix Analytics — what the collector, the login and the dashboard share.
 *
 * Not a route: Pages only turns a file into a route when it exports an
 * onRequest handler, and this one exports helpers. The folder's leading
 * underscore says the same to a person.
 *
 * Nothing here holds a secret. The three secrets live in the Pages project's
 * settings (see functions/va/SETUP.md) and arrive in `env`:
 *   VA_PASS_HASH   pbkdf2$<iterations>$<salt b64>$<hash b64>, from tools/va-secrets.mjs
 *   VA_TOTP_SEED   base32, the same seed the authenticator app holds
 *   VA_COOKIE_KEY  random, signs the session cookie; changing it logs everyone out
 */

export const DAY0 = Date.UTC(2026, 0, 1);       // the same day zero Loom counts from
export const vaDay = (ms = Date.now()) => Math.floor((ms - DAY0) / 86400000);

export const SESSION_HOURS = 12;
export const COOKIE = "__Host-va";

const enc = new TextEncoder();

export function b64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
export function unb64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const b64url = (bytes) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* Compares two strings in time that does not depend on where they differ. */
export function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hmac(keyText, message, hash = "SHA-256") {
  const key = await crypto.subtle.importKey("raw", typeof keyText === "string" ? enc.encode(keyText) : keyText,
    { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, typeof message === "string" ? enc.encode(message) : message));
}

export async function sha256hex(text, bytes = 16) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  return [...h.slice(0, bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- the password ----------
   PBKDF2-SHA256. The Workers runtime refuses more than 100,000 iterations,
   which is why the number is that and not higher; the authenticator code is
   the second factor that makes up for it. */
export async function passwordOk(password, stored) {
  const p = String(stored || "").split("$");
  if (p.length !== 4 || p[0] !== "pbkdf2") return false;
  const iterations = parseInt(p[1], 10);
  if (!(iterations >= 10000 && iterations <= 100000)) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(p[2]), iterations }, key, 256);
  return same(b64(bits), p[3]);
}

/* ---------- the authenticator code ----------
   RFC 6238: six digits, thirty seconds, SHA-1, as every authenticator app
   does by default. One step either side is accepted for a phone clock that
   drifts. Returns the step that matched, so the caller can refuse the same
   code twice, or -1. */
function unbase32(text) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = String(text || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export async function totpCode(seed, step) {
  const counter = new Uint8Array(8);
  let s = step;
  for (let i = 7; i >= 0; i--) { counter[i] = s & 255; s = Math.floor(s / 256); }
  const h = await hmac(unbase32(seed), counter, "SHA-1");
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}

export async function totpStep(seed, code, ms = Date.now()) {
  if (!/^\d{6}$/.test(String(code || ""))) return -1;
  const now = Math.floor(ms / 30000);
  for (const step of [now - 1, now, now + 1]) {
    if (same(await totpCode(seed, step), String(code))) return step;
  }
  return -1;
}

/* ---------- the session cookie ----------
   <expiry ms>.<nonce>.<HMAC of both>. Nothing about the person is in it, and
   nothing is stored on the server: a valid signature and a future expiry are
   the whole test. __Host- makes the browser refuse it unless it is Secure,
   for the whole site and for this host only. */
export async function sessionCookie(env, ms = Date.now()) {
  const exp = ms + SESSION_HOURS * 3600 * 1000;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const sig = b64url(await hmac(env.VA_COOKIE_KEY, `va1.${exp}.${nonce}`));
  return `${COOKIE}=${exp}.${nonce}.${sig}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;

export async function signedIn(request, env, ms = Date.now()) {
  if (!env.VA_COOKIE_KEY) return false;
  const jar = request.headers.get("Cookie") || "";
  const m = jar.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const p = m[1].split(".");
  if (p.length !== 3) return false;
  const exp = parseInt(p[0], 10);
  if (!Number.isFinite(exp) || exp <= ms || exp > ms + SESSION_HOURS * 3600 * 1000 + 60000) return false;
  return same(b64url(await hmac(env.VA_COOKIE_KEY, `va1.${p[0]}.${p[1]}`)), p[2]);
}

/* ---------- the headers every /va/ answer carries ---------- */
export const VA_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
  "Strict-Transport-Security": "max-age=31536000",
};

export function withHeaders(response, extra = VA_HEADERS) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(extra)) r.headers.set(k, v);
  return r;
}

/* The client's address, used only to slow down guessing at the login, and
   only ever stored as a keyed hash that is deleted after a day. */
export async function whoHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  return b64url(await hmac(env.VA_COOKIE_KEY || "va", "who." + ip)).slice(0, 22);
}
