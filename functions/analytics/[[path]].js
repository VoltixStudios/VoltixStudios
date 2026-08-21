/* Voltix Studios — first-party proxy for Umami analytics.
 *
 * A Cloudflare Pages Function. The browser talks only to this site; this file is
 * the only thing that talks to Umami. That buys three things:
 *
 *   1. No third-party script tag, so `tools/build_qr.py`'s claim that the site
 *      loads no third-party JavaScript stays true. (The code is still Umami's —
 *      it is the *requests* that are first-party.)
 *   2. Content blockers do not strip cloud.umami.is, so the numbers are not
 *      quietly biased towards people who do not run one.
 *   3. /analytics/* exists only on Cloudflare Pages, so the old
 *      voltixstudios.github.io mirror reports nothing without needing a filter.
 *
 * There is no build step and no wrangler.toml — Pages picks this up by path.
 */

const UPSTREAM = "https://cloud.umami.is";

/* A Map rather than an object literal: `params.path` comes off the URL, and an
   object would happily answer to "constructor" and turn this into an open proxy
   onto cloud.umami.is for anyone who found the address. */
const ROUTES = new Map([
  ["script.js", { method: "GET", cache: "public, max-age=86400" }],
  ["api/send", { method: "POST", cache: "no-store" }],
]);

/* Everything else the browser sends — cookies, Referer, the CF-* headers — is
   deliberately dropped. The tracker puts the referrer in the request body, so
   nothing here needs the header. */
const FORWARD = ["User-Agent", "Accept", "Accept-Language", "Content-Type"];

export async function onRequest({ request, params }) {
  const path = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  const route = ROUTES.get(path);
  if (!route || request.method !== route.method) {
    return new Response(null, { status: 404 });
  }

  const headers = new Headers();

  /* Umami has no cookie to recognise anyone by: a visitor is a salted hash of
     their IP address and user agent, computed on Umami's side. Behind a proxy
     every request appears to come from Cloudflare, so without this header every
     visitor on earth hashes to the same person — one visitor, one session, and
     journeys that are pure invention. It fails silently and plausibly, which is
     the worst way for it to fail, so it is the first thing to check. */
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) headers.set("X-Forwarded-For", ip);

  for (const name of FORWARD) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/${path}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.text() : undefined,
    });
  } catch (err) {
    /* Knowing how many people visited is never worth an error in someone's
       console, let alone a failed request they can see. */
    return new Response(null, { status: 204 });
  }

  const out = new Headers(upstream.headers);
  /* legal/website-privacy.html promises nothing is written to the visitor's
     device. Umami sends no cookie today; dropping it here means the promise
     holds even if that ever changes upstream. */
  out.delete("Set-Cookie");
  out.set("Cache-Control", route.cache);

  return new Response(upstream.body, { status: upstream.status, headers: out });
}
