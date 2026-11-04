/* Voltix Analytics — the Google Ads script.
 *
 * Runs inside the studio's Google Ads account (Tools → Bulk actions → Scripts),
 * scheduled every hour. It reads each campaign's last fourteen days and today,
 * cost, impressions, clicks, conversions (installs, for an App campaign), daily
 * budget and status, and posts them to Voltix Analytics, which shows them on the
 * dashboard's Today page beside the players it counted (functions/collect/ads.js).
 *
 * It reads; it never changes a campaign. It sends nothing about any person.
 *
 * KEY is the secret VA_ADS_KEY set in the Cloudflare Pages project. This copy,
 * in a public repository, holds a placeholder: the copy pasted into Google Ads
 * holds the real key and is kept nowhere else.
 */
var KEY = "PASTE_THE_KEY_HERE";
var URL = "https://voltixstudios.pages.dev/collect/ads";
var DAYS = 14;

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var to = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var from = Utilities.formatDate(new Date(Date.now() - DAYS * 86400000), tz, "yyyy-MM-dd");
  var rows = [];
  var it = AdsApp.search(
    "SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, " +
    "campaign_budget.amount_micros, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions " +
    "FROM campaign WHERE segments.date BETWEEN '" + from + "' AND '" + to + "'");
  while (it.hasNext()) {
    var r = it.next();
    rows.push({
      date: r.segments.date,
      campaign_id: String(r.campaign.id),
      campaign: r.campaign.name,
      status: r.campaign.status,
      channel: r.campaign.advertisingChannelType,
      budget_micros: r.campaignBudget ? Number(r.campaignBudget.amountMicros) : null,
      cost_micros: Number(r.metrics.costMicros || 0),
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      conversions: Number(r.metrics.conversions || 0),
    });
  }
  var res = UrlFetchApp.fetch(URL, {
    method: "post",
    contentType: "application/json",
    headers: { "X-VA-Key": KEY },
    payload: JSON.stringify({ v: 1, customer: account.getCustomerId(), currency: account.getCurrencyCode(), rows: rows }),
    muteHttpExceptions: true,
  });
  Logger.log("Sent " + rows.length + " campaign days (" + from + " to " + to + "): " +
             res.getResponseCode() + " " + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error("Voltix Analytics did not accept the figures: " + res.getResponseCode());
}
