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
 *   papersquadron  ~/voltix_studios/PaperSquadron/docs/ANALYTICS-VA.md
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
  // the ladder, Live weave and the shop (Loom's GDD 19.2 and 12.5, 3 November 2026)
  "rung_started", "rung_solved", "rung_failed", "climb_ended", "live_weave_toggled",
  "shop_opened", "panel_closed",
  // the hint seen, help sold during play (Loom's GDD 11 and 12.2, 4 November 2026)
  "hint_button_shown", "hint_pressed", "hint_tip_shown", "live_trial_started",
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

// Paper Squadron (Unity): ~/voltix_studios/PaperSquadron/docs/ANALYTICS-VA.md. Every event
// the game sends Firebase, under its own names, except the advert, purchase and first-session
// funnels, which take Loom's names so the shared pages read them (the game's VoltixAnalytics.cs
// renames them on the way out), plus the VA-only app_open, app_hidden and ad_paid.
const PAPERSQUADRON_EVENTS = [
  "app_open", "app_hidden", "screen_view", "consent_status", "ad_paid",
  "rewarded_ad_offered", "rewarded_ad_started", "rewarded_ad_completed", "interstitial_offered",
  "interstitial_shown", "ad_dismissed", "ad_failed",
  "tutorial_begin", "first_session_step", "tutorial_complete", "tutorial_backstop", "tutorial_hint",
  "tutorial_nudge", "card_shown", "card_tapped", "card_dismissed", "flight_assist",
  "run_start", "mission_start", "mission_failed", "orders_announced", "run_saved", "run_end",
  "level_end", "boss_defeated", "world_cleared", "content_cleared", "fly_again", "loadout_launch",
  "health_pack", "survival_start", "survival_end", "badge_earned",
  "gear_bought", "gear_upgraded", "gear_evolved", "shop_short", "sale_activated",
  "earn_virtual_currency", "spend_virtual_currency", "economy_converted",
  "weekly_crate_shown", "weekly_crate_opened", "weekly_crate_doubled", "weekly_kit_used",
  "iap_ready", "iap_unavailable", "iap_fetch_failed", "iap_store_open", "iap_store_close", "iap_offer",
  "purchase_started", "purchase_completed", "purchase_failed", "iap_pending", "iap_cancelled",
  "iap_abandoned", "iap_buy_blocked", "iap_duplicate", "iap_entitlement", "iap_invalid_receipt",
  "iap_redelivered", "iap_restore", "iap_unknown_sku", "offer_shown", "offer_buy", "offer_closed",
  "notif_permission", "notif_toggled", "notif_scheduled", "notif_suppressed", "notif_opened",
  "notif_token", "push_received", "review_prompt", "pgs_signin", "rc_activated", "rc_fetch_fail",
  "cloud_save_adopt", "cloud_save_conflict", "cloud_save_fail", "cloud_save_push", "cloud_save_resolve",
  "cloud_save_restore", "cloud_save_restored_install", "stats_push_fail",
  "lb_fetch_fail", "lb_link_conflict", "lb_link_fail", "lb_link_ok", "lb_profile_fail", "lb_rank_fail",
  "lb_submit_fail", "lb_submit_ok",
  "account_delete_start", "account_delete_ok", "account_delete_fail", "account_delete_orphan", "va_forgotten",
];

const PAPERSQUADRON_PROPS = [
  "app_version", "run_counter", "best_wave", "worlds_cleared", "payer", "no_ads", "notif_on",
  "rc_variant", "days_played", "streak", "language", "ads_consent",
];

const LOOM_PROPS = [
  "app_version", "version_code", "first_day", "payer", "days_played", "streak",
  "best_streak", "reminder_on", "preferred_loom", "ads_consent", "best_level", "live_weave",
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
  // The licence key is the one built into the game (IapService.LicenseKeyBase64).
  papersquadron: {
    pkg: "com.voltixstudios.papersquadron",
    events: new Set(PAPERSQUADRON_EVENTS),
    props: new Set(PAPERSQUADRON_PROPS),
    licence:
      "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAj6YF8xiiydrfoOCqZEl9NnptX1M6XyzaLejFth4p85hm7hsoPnbl+4KUmwGDJp3hVaC0v56WhlKrDZsT9EgBurZfhqxQ+8HCj6fR5VrO6SHwp75eXN5u+qMGYCyGz45j7b0aqrhVqOntQWFz80/TdeaYi3IqsUeoOVwZRz0pMK7nKJjZ+1egAcrlht/Cj43jVm0DZik/NXIYiok8jZwWD0gEOE2LqUk2lJmgIcgCZKanYVdRxBaznEk0TwNgtv3us2sfdZ6WR4VAKFd8dis7s2DfsqQ3ND/eYOHbwVzy2pbGMkS9kwSYTjeKIObxriJQg+YVSuPjJvCx4Zp3suo8FQIDAQAB",
  },
};
