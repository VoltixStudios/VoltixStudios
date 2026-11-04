/* Voltix Analytics — Google Ads figures, at POST /collect/ads.
 *
 * The dashboard cannot read Google Ads itself (the API wants a developer token
 * the studio does not have). Instead a Google Ads script runs inside Sr. Orra's
 * own advertising account every hour (tools/google-ads-script.js, pasted into
 * Google Ads → Tools → Bulk actions → Scripts) and posts each campaign's day:
 * cost, impressions, clicks, conversions (installs, for an App campaign), its
 * daily budget and status. They are written to va_ads_day, one row per day and
 * campaign, replaced each time the same day is sent again, because Google keeps
 * revising its recent days.
 *
 * The script proves itself with the secret VA_ADS_KEY, held by the Pages project
 * and by the script and nowhere else (never in this repository). Without the
 * secret set here, nothing is accepted.
 */

import { same } from "../_va/lib.js";

const MAX_ROWS = 500;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const DAY0 = Date.UTC(2026, 0, 1);
function dayOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === "string" ? iso : "");
  if (!m) return null;
  const d = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - DAY0) / 86400000);
  return d >= 0 && d < 3650 ? d : null;
}
const num = (v, max) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };
const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) || null : null);

export async function onRequestPost({ request, env }) {
  if (!env.VA || !env.VA_ADS_KEY) return json({ error: "setup" }, 503);
  if (!same(request.headers.get("X-VA-Key") || "", env.VA_ADS_KEY)) return json({ error: "key" }, 401);

  const raw = await request.text();
  if (raw.length > 256 * 1024) return json({ error: "size" }, 400);
  let b;
  try { b = JSON.parse(raw); } catch (e) { return json({ error: "body" }, 400); }
  if (!b || b.v !== 1 || !Array.isArray(b.rows) || b.rows.length > MAX_ROWS) return json({ error: "body" }, 400);

  const currency = /^[A-Z]{3}$/.test(b.currency || "") ? b.currency : null;
  const now = Date.now();
  const db = env.VA;
  const writes = [];
  let refused = 0;
  for (const r of b.rows) {
    const day = r && dayOf(r.date);
    const id = r && text(String(r.campaign_id || ""), 32);
    const cost = r && num(r.cost_micros, 1e13);
    if (day === null || !id || !/^\d+$/.test(id) || cost === null) { refused++; continue; }
    writes.push(db.prepare(
      `INSERT INTO va_ads_day (day, campaign_id, campaign, status, channel, currency, cost_micros, impressions, clicks,
                               conversions, budget_micros, updated)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT (day, campaign_id) DO UPDATE SET campaign = excluded.campaign, status = excluded.status,
         channel = excluded.channel, currency = excluded.currency, cost_micros = excluded.cost_micros,
         impressions = excluded.impressions, clicks = excluded.clicks, conversions = excluded.conversions,
         budget_micros = excluded.budget_micros, updated = excluded.updated`
    ).bind(day, id, text(r.campaign, 120), text(r.status, 20), text(r.channel, 40), currency, Math.round(cost),
      Math.round(num(r.impressions, 1e12) || 0), Math.round(num(r.clicks, 1e12) || 0), num(r.conversions, 1e9) || 0,
      num(r.budget_micros, 1e13) === null ? null : Math.round(num(r.budget_micros, 1e13)), now));
  }
  writes.push(db.prepare("INSERT INTO va_meta (k, v) VALUES ('ads_last', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v")
    .bind(JSON.stringify({ at: now, rows: writes.length, refused, customer: text(String(b.customer || ""), 20) })));
  try {
    await db.batch(writes);
  } catch (e) {
    return json({ error: "store" }, 503);
  }
  return json({ ok: true, kept: writes.length - 1, refused });
}
