/* Voltix Analytics — /va/api/ping: answers only to a signed-in browser (the
   middleware sees to that), with the day and whether the database is bound.
   The dashboard's other endpoints arrive with it, in phase 4 of the brief. */

import { vaDay } from "../../_va/lib.js";

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({ ok: true, day: vaDay(), store: !!env.VA }), {
    headers: { "Content-Type": "application/json" },
  });
}
