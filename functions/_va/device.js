/* Voltix Analytics — signing in with a fingerprint, from Sr. Orra's VA app
 * (~/voltix_studios/va-app, 4 November 2026).
 *
 * Not a route; the helpers behind functions/va/device/.
 *
 * Once, while signed in with the password and code, the app makes a key pair
 * inside the phone's secure hardware, usable only after the phone's own
 * fingerprint check, and registers the public half here (va_device). From then
 * on the app signs a one-time challenge with it, and a good signature opens the
 * same session the password and code open. The private key never leaves the
 * phone, and nothing here can sign: a copy of this database opens nothing.
 *
 * The two factors become the phone's key (something held) and the fingerprint
 * (something of the person), in place of the password (something known) and the
 * authenticator (something held).
 *
 * A challenge is <expiry ms>.<nonce>.<HMAC of both>, valid for two minutes, so
 * nothing about it is stored until it is used; a device accepts only a challenge
 * that expires later than the last one it used, so none is accepted twice.
 */

import { hmac, b64, b64url, unb64, same } from "./lib.js";

export const CHALLENGE_MS = 2 * 60 * 1000;
export const ENROL_FRESH_MS = 10 * 60 * 1000;   // the password login an enrolment rides on
export const MAX_DEVICES = 5;

export async function makeChallenge(env, ms = Date.now()) {
  const exp = ms + CHALLENGE_MS;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return `${exp}.${nonce}.${b64url(await hmac(env.VA_COOKIE_KEY, `vadev1.${exp}.${nonce}`))}`;
}

/* The challenge's expiry when it is one of ours and still current, else 0. */
export async function challengeExp(env, challenge, ms = Date.now()) {
  if (typeof challenge !== "string" || challenge.length > 200) return 0;
  const p = challenge.split(".");
  if (p.length !== 3) return 0;
  const exp = parseInt(p[0], 10);
  if (!Number.isFinite(exp) || exp <= ms || exp > ms + CHALLENGE_MS + 5000) return 0;
  return same(b64url(await hmac(env.VA_COOKIE_KEY, `vadev1.${p[0]}.${p[1]}`)), p[2]) ? exp : 0;
}

/* An EC P-256 public key as the phone exports it (X.509 SubjectPublicKeyInfo, base64). */
export async function importKey(spkiB64) {
  if (typeof spkiB64 !== "string" || spkiB64.length > 400) return null;
  try {
    return await crypto.subtle.importKey("spki", unb64(spkiB64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch (e) {
    return null;
  }
}

/* Android signs ECDSA as DER (SEQUENCE of two INTEGERs); Web Crypto wants the
   two 32-byte numbers side by side. */
export function derToRaw(der) {
  if (der.length < 8 || der[0] !== 0x30) return null;
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const out = new Uint8Array(64);
  for (const at of [0, 32]) {
    if (der[i] !== 0x02) return null;
    let len = der[i + 1];
    let start = i + 2;
    i = start + len;
    while (len > 32 && der[start] === 0) { start++; len--; }
    if (len > 32 || i > der.length) return null;
    out.set(der.subarray(start, start + len), at + 32 - len);
  }
  return out;
}

export async function signatureOk(key, challenge, sigB64) {
  if (typeof sigB64 !== "string" || sigB64.length > 200) return false;
  let raw;
  try { raw = derToRaw(unb64(sigB64)); } catch (e) { return false; }
  if (!raw) return false;
  try {
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, new TextEncoder().encode(challenge));
  } catch (e) {
    return false;
  }
}

export const newDeviceId = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

export const jsonAnswer = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export { b64 };
