/* Voltix Analytics — the paid campaigns the Today page follows.
 *
 * Not a route. The dashboard cannot read Google Ads, so a campaign is written
 * here by hand when it starts and taken out when it is over: its games, its
 * countries (two-letter codes, as Cloudflare reports a player's country), its
 * first day and the day it is to be judged. A new player from one of its
 * countries since its first day is counted as the campaign's; every other new
 * player as organic. That is an approximation, and the page says so.
 *
 * Spend comes from Google Ads itself: a script in the advertising account posts
 * each campaign's day to /collect/ads every hour (va_ads_day).
 */
export const CAMPAIGNS = [
  {
    name: "Google Ads test",
    note: "PS-ADS-TEST and Loom-ADS-TEST: EUR 1.00 a day each, target cost per install EUR 0.15, EUR 30 across both (D-057, D-066).",
    games: ["loom", "papersquadron"],
    /* Each game's campaign by its name in Google Ads, so the spend the Google Ads script
       posts (va_ads_day) can be put beside the players VA counted. */
    ads: { loom: "Loom-ADS-TEST", papersquadron: "PS-ADS-TEST" },
    countries: ["DE", "FR", "NL", "US", "CA", "AE", "SA", "NO", "SE", "AU", "NZ"],
    start: "2026-11-04",
    review: "2026-11-18",
    budgetEur: 30,
  },
];
