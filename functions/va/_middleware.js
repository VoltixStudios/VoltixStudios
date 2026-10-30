/* Voltix Analytics — the lock on everything under /va/ (D-072).
 *
 * Runs before every request under /va/, the static page as well as the API.
 * Without a valid session cookie, the API answers 401 and anything else is
 * sent to /va/login. Every answer under /va/ carries the headers in
 * VA_HEADERS: no framing, no indexing, no caching, nothing loaded from
 * another site.
 *
 * The page itself holds no data; all of it comes through /va/api/, which this
 * guards. That matters because this repository is public and GitHub Pages
 * mirrors it without any Function: there, /va/ is an empty page.
 */

import { signedIn, withHeaders, VA_HEADERS } from "../_va/lib.js";

export async function onRequest({ request, env, next }) {
  const path = new URL(request.url).pathname;
  if (path === "/va/login" || path === "/va/login/") return withHeaders(await next());

  if (!(await signedIn(request, env))) {
    if (path.startsWith("/va/api/")) {
      return new Response(JSON.stringify({ error: "login" }), {
        status: 401, headers: { "Content-Type": "application/json", ...VA_HEADERS },
      });
    }
    return new Response(null, { status: 302, headers: { Location: "/va/login", ...VA_HEADERS } });
  }
  return withHeaders(await next());
}
