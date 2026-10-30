# Voltix Analytics — turning it on

Voltix Analytics (D-072) is three Pages Functions and one D1 database:

- `functions/collect/` — the collector the games post to, and the player's deletion;
- `functions/va/` — the login and the dashboard's API, behind the login;
- `va/` — the dashboard page itself, which holds no data.

The code ships with the site. Nothing works until the steps below are done, and until
then `/collect` answers 503 and the login says it is not set up. The games keep their
events queued in the meantime, as they do offline.

**Zero euros.** Every step here is on Cloudflare's free plans. None of them asks for a
card. If a screen asks for payment details, stop: something other than what is
described here has been chosen.

## 0. Check nothing paid is attached

Cloudflare dashboard → **Manage account → Billing → Subscriptions**. It should list no
paid plan. If one is there, or a card is on file, decide whether to remove it before
going on. Free plans refuse work past their limits instead of billing, but only while
nothing paid is attached to the account.

## 1. Create the database

**Storage & Databases → D1 SQL Database → Create database**. Name: `va`. Location:
automatic.

Then apply the tables. Either open the database → **Console**, paste the whole of
`functions/va/schema.sql` and run it; or, from this repository, after `npx wrangler
login` once:

```
npx wrangler d1 execute va --remote --file functions/va/schema.sql
```

Running it again later is safe: every statement is `IF NOT EXISTS`.

## 2. Bind it to the site, for Production only

**Workers & Pages → the site's Pages project → Settings → Bindings → Add → D1
database**. Variable name: `VA`. Database: `va`. **Production only.**

Leave Preview without it on purpose. A preview deployment is reachable at its own
address by anyone who guesses it, and without the binding there is nothing to read
there and nowhere to write.

A binding only reaches the site on the *next* deploy.

## 3. The login secrets

On this PC, from the repository:

```
node tools/va-secrets.mjs
```

It asks for a password twice (at least 14 characters; it is never printed or saved),
then prints three values and a QR code. Put each into **the Pages project → Settings →
Variables and Secrets → Add**, type **Secret**, **Production**:

| Name | What it is |
| --- | --- |
| `VA_PASS_HASH` | the password's PBKDF2 hash; the password itself is stored nowhere |
| `VA_TOTP_SEED` | the authenticator seed |
| `VA_COOKIE_KEY` | signs the session cookie |

Scan the QR code with an authenticator app (Google Authenticator, Aegis, 1Password, …).
The script prints the current code so you can check the app agrees. Close the terminal
afterwards.

**To change the password**, run the script again and replace all three. **To sign out
every browser at once**, replace only `VA_COOKIE_KEY`. **If the phone with the
authenticator is lost**, run the script again: the old seed stops working the moment
the new one is saved.

## 3b. The nightly summaries (a small Worker of their own)

The dashboard reads summaries that a Worker rebuilds every night at 02:10 UTC
(`workers/va-nightly/`). Pages Functions cannot run on a schedule, so it is a
separate Worker. It has no address, so nothing can call it. Free plan: cron
triggers are included.

1. Put the database's id into `workers/va-nightly/wrangler.jsonc` (`database_id`).
   It is shown under Storage & Databases → D1 → va, or by `npx wrangler d1 list`.
   It is not a secret.
2. From `workers/va-nightly/`, for the first run only, add the variable
   `VA_BACKFILL_DAYS = 90` (Workers & Pages → va-nightly → Settings → Variables),
   so the first night summarises everything there is. Remove it the next day.
3. `npx wrangler deploy` from `workers/va-nightly/`, with your word, as for any
   deployment.

Its test, `bash workers/va-nightly/test.sh`, seeds a local database with known
players and checks every summary (25 checks).

## 4. Deploy and check

Push the site (with your word, as always). Then, in a private browser window:

1. `https://voltixstudios.pages.dev/va/` should send you to `/va/login`.
2. The password and the code should sign you in, and the page should say "Signed in".
3. `https://voltixstudios.pages.dev/va/api/ping` in another private window, not signed
   in, should answer `{"error":"login"}`.

## What protects it, and what does not

- **The login** is the only lock: password and authenticator code, both required. Five
  failures from one address, or twenty from anywhere, in fifteen minutes lock it for
  fifteen minutes. A code works once only.
- **Every API call checks the cookie**, not only the page. The page holds no data.
- **There is no custom domain**, so Cloudflare's WAF rate-limiting rules, which work only
  on a domain the account owns, cannot be used. The collector protects itself instead:
  a 64 KB body limit, at most 50 events a batch, at most 3,000 events per install per
  day, and every field checked. What it cannot stop is a flood from many made-up
  installs. Such a flood can use up the free daily limits. The cost of that is an outage
  until midnight UTC for the site's Functions and lost or delayed events. It costs no
  money, and the static site keeps working. If the studio ever adds its own domain, one
  free rate-limiting rule on `/collect` and `/va/login` closes this.
- **This repository is public**, so the code, including the paths, is readable by anyone.
  That is fine: nothing secret is in it. The secrets live only in the Pages project's
  settings.
- **GitHub Pages mirrors this repository without the Functions.** There, `/va/` is the
  empty page and `/collect` does not exist.

## Tests

```
bash functions/va/test.sh
```

65 checks against a local D1 with made-up secrets and a made-up licence key: the
collector's rules, purchase signatures, the daily cap, deletion, and the login (wrong
password, wrong code, a code used twice, forged and expired cookies, the lockout,
headers). Nothing touches the account.
