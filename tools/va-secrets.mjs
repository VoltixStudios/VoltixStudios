#!/usr/bin/env node
/* Voltix Analytics — makes the three login secrets (functions/va/SETUP.md).
 *
 *   node tools/va-secrets.mjs            asks for the password twice, prints the
 *                                        three secrets and the authenticator QR
 *   node tools/va-secrets.mjs --code S   prints the current six-digit code for
 *                                        seed S (the tests use it)
 *
 * Nothing is written to disk and nothing is sent anywhere. The password itself
 * is never printed: only its PBKDF2 hash, which is what the site stores.
 * VA_PASSWORD in the environment skips the prompt (the tests use it).
 */
import { webcrypto as crypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import readline from "node:readline";

const ITERATIONS = 100000;                     // the most the Workers runtime accepts
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

function base32(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of text.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    value = (value << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function totp(seed, ms = Date.now()) {
  let step = Math.floor(ms / 30000);
  const counter = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { counter[i] = step & 255; step = Math.floor(step / 256); }
  const key = await crypto.subtle.importKey("raw", unbase32(seed), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

const args = process.argv.slice(2);
if (args[0] === "--code") {
  console.log(await totp(args[1] || ""));
  process.exit(0);
}

let password = process.env.VA_PASSWORD;
if (!password) {
  password = await ask("Dashboard password (at least 14 characters): ");
  if (password.length < 14) { console.error("Too short: use at least 14 characters."); process.exit(1); }
  if ((await ask("Again: ")) !== password) { console.error("The two did not match."); process.exit(1); }
}

const seed = base32(crypto.getRandomValues(new Uint8Array(20)));
const cookieKey = b64(crypto.getRandomValues(new Uint8Array(32)));
const passHash = await hash(password);

if (process.env.VA_PASSWORD) {
  console.log(JSON.stringify({ VA_PASS_HASH: passHash, VA_TOTP_SEED: seed, VA_COOKIE_KEY: cookieKey }));
  process.exit(0);
}

const uri = `otpauth://totp/Voltix%20Analytics?secret=${seed}&issuer=Voltix%20Studios&digits=6&period=30`;
console.log(`
Put these three into Cloudflare -> Workers & Pages -> the site's Pages project ->
Settings -> Variables and Secrets, each as type "Secret", for Production:

  VA_PASS_HASH   ${passHash}
  VA_TOTP_SEED   ${seed}
  VA_COOKIE_KEY  ${cookieKey}

Then add the seed to your authenticator app, by scanning the code below or by
typing the seed by hand ("Voltix Analytics", time-based, 6 digits).
`);
const qr = spawnSync("qrencode", ["-t", "ansiutf8", uri], { stdio: ["ignore", "inherit", "ignore"] });
if (qr.error || qr.status !== 0) {
  /* No QR code can be drawn here (sudo apt install qrencode adds it). Typed by
     hand, the seed is easy to get wrong, so it is shown in groups of four;
     Google Authenticator answers "key is too short" to a seed with a group
     missing. */
  console.log(`  No QR code: qrencode is not installed (sudo apt install qrencode, then run this again).
  To type it instead, in Google Authenticator: + -> Enter a setup key
    Account name:  Voltix Analytics
    Your key:      ${seed.match(/.{1,4}/g).join(" ")}
                   (${seed.length} characters, letters A-Z and digits 2-7; the spaces do not matter)
    Type of key:   Time based`);
}
console.log(`
Check: the app should now show the same code as this line - ${await totp(seed)}
Close this terminal afterwards so the secrets are not left on screen.
`);
