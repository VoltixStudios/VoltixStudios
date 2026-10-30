/* Voltix Analytics — the games the collector accepts, and what each may say.
 *
 * The collector refuses any event or property not named here, so a new event
 * in a game is also a line in this file. That is deliberate: the list is the
 * taxonomy, and a name that is not on it would be a chart nobody defined.
 *
 * `licence` is the game's Play licence key — a public key, the same one built
 * into the app (Loom: PLAY_LICENCE_KEY in its repository). It is not a secret.
 * VA_LICENCE_<GAME> in the environment overrides it, which the tests use.
 * A game whose key does not exist yet has `licence: null`: its purchases are
 * stored, never verified, until the key is added here.
 *
 * Each game's list is its tracking plan, in the game's own repository:
 *   loom           ~/voltix_studios/Loom/ANALYTICS.md
 *   sombra         ~/voltix_studios/Sombra/docs/ANALYTICS.md (AshenRise)
 *   pocketfoundry  ~/voltix_studios/PocketFoundry/docs/ANALYTICS.md
 * The install source (utm_*) is not a user property here: it arrives once, in
 * the batch's `src`, and is kept on the install.
 */

const LOOM_EVENTS = [
  // sent since 16 September 2026, the same names GA4 receives
  "ad_privacy_opened", "app_hidden", "archive_opened", "coach_pointed", "coach_spoke",
  "consent_status", "day_opened", "demo_ended", "demo_shown", "extra_weave_taken",
  "help_opened", "hint_taken", "interstitial_shown", "intro_shown", "js_error",
  "loom_advice_shown", "loom_advice_taken", "loom_chosen", "milestone_shown",
  "offer_dismissed", "offer_shown", "op_previewed", "purchase_completed",
  "purchase_failed", "purchase_restored", "purchase_started", "puzzle_failed",
  "puzzle_solved", "puzzle_started", "quilt_opened", "quilt_shared", "rate_opened",
  "reminder_accepted", "reminder_declined", "reminder_offered", "reminder_opened",
  "reminder_permission_denied", "review_requested", "rewarded_ad_completed",
  "rewarded_ad_offered", "rewarded_ad_started", "session_length", "share_pressed",
  "site_opened", "solution_replayed", "stats_opened", "streak_at_churn", "weave_submitted",
  // added for VA (brief of 29 October 2026, "What the game must add")
  "app_open", "install_source", "first_session_step", "day_result", "purchase", "ad_paid",
];

// AshenRise (codename sombra): ~/voltix_studios/Sombra/docs/ANALYTICS.md §3
const SOMBRA_EVENTS = [
  "app_open", "app_hidden", "js_error", "consent_status", "save_issue", "settings_changed",
  "install_source", "tutorial_begin", "tutorial_step", "tutorial_complete", "first_session_step",
  "level_start", "level_end", "player_died", "boss_fight", "special_used",
  "hero_join", "hero_upgrade", "skill_upgrade", "skill_equipped", "item_found", "item_equipped",
  "item_enhanced", "forge_fused", "redeemed_upgrade", "commander_joined", "quest_complete",
  "daily_gift", "supply_crate", "world_reached", "career_complete",
  "earn_virtual_currency", "spend_virtual_currency",
  "shop_open", "offer_shown", "offer_dismissed", "chest_opened", "armoury_bought", "pass_claimed",
  "purchase_started", "purchase_pending", "purchase_failed", "purchase_completed", "purchase",
  "rewarded_ad_offered", "rewarded_ad_started", "rewarded_ad_completed", "interstitial_shown", "ad_paid",
];

const SOMBRA_PROPS = [
  "app_version", "version_code", "first_day", "days_played", "furthest_level", "heroes",
  "main_hero", "power", "payer", "pass_active", "no_ads", "blood_on", "language", "ads_consent",
];

// Pocket Foundry: ~/voltix_studios/PocketFoundry/docs/ANALYTICS.md, "The events"
const POCKETFOUNDRY_EVENTS = [
  "app_open", "app_hidden", "js_error", "consent_status", "save_issue", "install_source",
  "tutorial_begin", "first_session_step", "tutorial_complete",
  "level_start", "order_run", "level_end", "hint_used", "solution_used", "intro_seen",
  "repair", "building_upgrade", "level_running", "tier_seen", "connection_built",
  "workshop_collect", "decoration_bought", "store_upgrade",
  "daily_reward", "contract_paid", "contract_swapped", "season_stars", "tier_claimed",
  "earn_virtual_currency", "spend_virtual_currency",
  "shop_open", "offer_shown", "offer_dismissed", "purchase_started", "purchase_pending",
  "purchase_failed", "purchase",
  "rewarded_ad_offered", "rewarded_ad_started", "rewarded_ad_completed", "interstitial_shown", "ad_paid",
  // the reminders and Firebase's messages (PocketFoundry PF-019, 30 October 2026)
  "notify_asked", "notify_answer", "notif_open",
];

const POCKETFOUNDRY_PROPS = [
  "app_version", "version_code", "first_day", "days_played", "furthest_island", "orders_filled",
  "repairs", "season_tier", "pass_owner", "payer", "no_ads", "streak", "ads_consent", "notify_on",
];

const LOOM_PROPS = [
  "app_version", "version_code", "first_day", "payer", "days_played", "streak",
  "best_streak", "reminder_on", "preferred_loom", "ads_consent",
];

export const GAMES = {
  loom: {
    pkg: "com.voltixstudios.loom",
    events: new Set(LOOM_EVENTS),
    props: new Set(LOOM_PROPS),
    licence:
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtpCam7HAnh/uwttyaIStWPdyHI3jB+lVtXm6kUZwvJdE3oRKpBGxevn6dK2tolZ35FtxNmRukT24qQk1JrPZCGrMW2iZBCOANhXvzg2qgmuZ+gQ73MZf3aqDQzkFK0MutolUzFsdVY9HUt2pjnzf55EFrWm+qiPEE5iXb/iG/u3h1bwyq9malrN41bpQuafcPuLsFMk/UBJ6gSw06hOItzXqYAPVtNEbNEKk9NxJNL9Zggyev7DE+MUbvINHZqe4R+abQvE1FOQgFWg1MaP7+JBBHnMsytCGcScQHkgK55QjfBxJnCIVZ5WNArgblZ3g5mNFcNsIxXVLk0aiCbNKQwIDAQAB",
  },
  sombra: {
    pkg: "com.voltixstudios.ashenrise",
    events: new Set(SOMBRA_EVENTS),
    props: new Set(SOMBRA_PROPS),
    licence: null,
  },
  pocketfoundry: {
    pkg: "com.voltixstudios.pocketfoundry",
    events: new Set(POCKETFOUNDRY_EVENTS),
    props: new Set(POCKETFOUNDRY_PROPS),
    licence: null,
  },
};
