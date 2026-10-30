/* Voltix Analytics — sign out, at /va/logout. Clears this browser's cookie.
   To sign out every browser at once, change VA_COOKIE_KEY (SETUP.md). */

import { clearCookie } from "../_va/lib.js";

export async function onRequestPost() {
  return new Response(null, { status: 303, headers: { Location: "/va/login", "Set-Cookie": clearCookie() } });
}
