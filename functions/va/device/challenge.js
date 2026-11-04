/* Voltix Analytics — /va/device/challenge: a one-time challenge for the VA app
   to sign with its fingerprint key (functions/_va/device.js). Needs no session:
   it is the way in. It holds nothing and stores nothing. */

import { makeChallenge, jsonAnswer } from "../../_va/device.js";

export async function onRequestPost({ env }) {
  if (!env.VA_COOKIE_KEY) return jsonAnswer({ error: "setup" }, 503);
  return jsonAnswer({ challenge: await makeChallenge(env) });
}
