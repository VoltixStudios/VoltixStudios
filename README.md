# VoltixStudios

The Voltix Studios website — a landing page covering the studio and its two
games, **Paper Squadron** and **CoreWard**, plus the legal documents Google Play
requires those games to publish.

Live at <https://voltixstudios.pages.dev/>, served by Cloudflare Pages.

> The site is deployed from this repository to Cloudflare Pages, which serves it
> at the **root** of `voltixstudios.pages.dev` — no repo-name path segment, and
> `/app-ads.txt` lands where AdMob looks for it. Extensionless paths work too:
> `/legal/paper-squadron/privacy-policy` and the `.html` form both resolve, so
> the `<link rel="canonical">` and `og:url` tags name the extensionless form to
> keep the two from competing as duplicates.
>
> GitHub Pages still answers on the old project URL
> (`voltixstudios.github.io/VoltixStudios/`). Every path in the site is
> relative, so it renders there fine — but its pages now declare Cloudflare as
> canonical, which is the intent. If that copy is not wanted, turn Pages off in
> the repository settings.
>
> Absolute URLs live in the `<link rel="canonical">`, `og:` and `sitemap.xml`
> entries plus `robots.txt` and `app-ads.txt`; a future host move means editing
> those, and nothing else.

## Layout

```
index.html                 the landing page
404.html                   self-contained; no assets, works at any depth
robots.txt  sitemap.xml
app-ads.txt                authorises AdMob to sell our inventory — see below
legal/paper-squadron/      privacy policy + account deletion, EN/ES
legal/coreward/            privacy policy + terms & virtual currency, EN/ES
legal/website-privacy.html what the *site* measures, EN/ES — see Analytics below
functions/analytics/       Pages Function: first-party proxy for Umami
assets/css/style.css       palette, header, buttons, social, footer
assets/css/doc.css         long-form document pages only
assets/js/main.js          sticky header, scroll reveal, scroll-spy — all optional
assets/js/doc.js           language switch on the document pages — also optional
assets/js/analytics.js     click and scroll-depth events — also optional
assets/img/                generated, committed
tools/build_assets.py
tools/build_qr.py          the Play Store QR in the Paper Squadron section
```

There is no build step. Edit, commit, push; Cloudflare Pages serves it as-is.
`functions/` is the one exception to "static": Cloudflare picks it up by path,
with no config and nothing added to the deploy. It does not exist on the
GitHub Pages mirror, which is deliberate — see Analytics.

> Because nothing fingerprints the filenames, every page loads the stylesheet as
> `style.css?v=N`. **Bump that number in every page that links it, whenever
> `style.css` changes** — `grep -rl 'style.css?v=' --include=*.html .` lists
> them, so the rule does not rot as pages are added. A browser holding the old stylesheet against new markup does not
> render an old page, it renders a broken one — new elements land with none of
> their rules.

## The legal pages

Each game's documents are what its store listing and its ad SDK point at, so the
URLs are load-bearing: once a Play listing or an AdMob app references one, it has
to keep resolving.

```
legal/coreward/privacy-policy.html    Play Console "Privacy policy" + AdMob
legal/coreward/terms.html             design doc §14's virtual-currency terms
legal/paper-squadron/privacy-policy.html
legal/paper-squadron/delete-account.html
legal/website-privacy.html            the site itself, not a game — no store
                                      references it, so this URL is ours to move
```

CoreWard's policy is deliberately far shorter than Paper Squadron's, because the
game does far less: no account, no cloud save, no analytics, no crash reporting,
no notifications, no leaderboard backend. Only AdMob and Play Billing leave the
device. **If any of that changes — the moment Firebase or Play Games is wired in
— the policy is wrong and has to be updated in the same change**, along with the
Play data-safety form, which has to agree with it.

The Cores wording in `terms.html` is a verbatim copy of the string the game shows
on its own store screen (`Store.CurrencyTermsKey` in the CoreWard repo, in both
languages). If one is reworded the other has to move with it.

> **`app-ads.txt` resolves at the root — check the Play listing agrees.**
> Crawlers take the developer website from the Play listing and fetch
> `/app-ads.txt` at the *root of that domain*. Cloudflare Pages serves the site
> at the root, so `voltixstudios.pages.dev/app-ads.txt` is live and is what a
> crawler asks for. The remaining half is the Play Console: the developer
> website field on each listing has to name `voltixstudios.pages.dev`. If it
> still points at the old GitHub project URL, the crawler fetches
> `voltixstudios.github.io/app-ads.txt`, finds nothing, and the fill and eCPM
> cost stays.

## Images

`assets/img/` is generated from the source art, which lives outside this repo —
the originals are multi-megabyte PNGs and the site ships trimmed WebP.

```bash
python3 tools/build_assets.py          # needs Pillow
```

It reads from `~/voltix_studios/logos`, `~/paper_ace` and `~/voltix_studios/CoreWard`
by default; pass `--logo`, `--paper` or `--coreward` to point elsewhere. Re-run it
whenever a logo or a piece of key art changes, and commit the result.

The one hand-measured thing in it is `STRATA_BOUNDS`, the five panel edges in
CoreWard's `images/backgrounds.png`. Those panels are not evenly spaced, so if that
sheet is regenerated the numbers need re-checking.

`assets/img/ps-play-qr.svg` — the Play Store QR in the Paper Squadron section — is
the exception. It is drawn from a URL rather than from any source art, so it has
its own generator.

```bash
python3 tools/build_qr.py              # needs OpenCV
```

It encodes `PLAY_URL` — the constant at the top of the script is the only
human-readable record of what the image says — then reads the result back with
OpenCV's detector and refuses to write a file it cannot decode. A QR pointing at
the wrong address passes every review a person can give it, so the check belongs
in the tool. If the Play URL ever changes, edit the constant and re-run.

## Preview locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

That serves the static files but not `functions/`, so `/analytics/*` 404s and no
events are sent — which is usually what you want while editing. To exercise the
proxy, use `npx wrangler pages dev .` instead, or push to a branch and open the
Cloudflare Pages preview.

## Analytics

The site uses [Umami](https://cloud.umami.is) — cookieless, and on the free tier
it still gives custom events, funnels and user journeys, which is the whole reason
it was picked over Cloudflare Web Analytics. Cloudflare's own tool has no custom
events at all, so it could report traffic but never a click.

Three pieces:

```
functions/analytics/[[path]].js   proxies /analytics/* -> cloud.umami.is
assets/js/analytics.js            decides what counts as an event
<script> in every page            the loader, carrying the website ID
```

The website ID is public by design and lives in the markup, in **every page** —
the same copied-into-every-page tax as the sprite and the social links. There is
no API key and no environment variable on the client side.

**Everything is proxied, nothing is third-party.** The browser only ever talks to
`voltixstudios.pages.dev/analytics/`. That keeps `tools/build_qr.py`'s "the site
loads no third-party JavaScript" true, and stops content blockers from quietly
biasing the numbers towards people who do not run one. The honest nuance: the
tracker *code* is still Umami's — it is the *requests* that are first-party.

> **The proxy must forward `CF-Connecting-IP` as `X-Forwarded-For`.** Umami has no
> cookie to recognise anyone by; a visitor is a salted hash of IP and user agent,
> computed on Umami's side. Behind a proxy every request appears to come from
> Cloudflare, so without that header every visitor on earth hashes to the same
> person — one visitor, one session, and journeys that are pure invention. It
> fails silently and plausibly. The check is to load the site from two different
> networks and confirm Umami says two visitors, not one.

Events are derived from the `href` in `analytics.js`, **not** from
`data-umami-event` attributes in the markup. Nearly thirty links spread across
every page is nearly thirty chances to forget one; this way a new social network
or a new page needs no tracking edit at all. What is recorded: `play-preregister`, `social`
(with network and placement), `email` (contact vs. deletion request), `outbound`,
`section` for scroll depth, and `lang-switch`. Internal navigation deliberately is
not — the destination logs its own page view and Umami stitches the journey from
those, so an event would add an unload race for information already in hand.

`data-exclude-hash` is set on the loader. Without it every `#games` nav click on
the landing page counts as a page view and buries the real paths.

The script tag's `src` is root-absolute (`/analytics/script.js`) where everything
else in the site is relative. That is the exception that keeps the old
`voltixstudios.github.io` copy out of the data: the path resolves only on
Cloudflare Pages, so the mirror 404s and reports nothing.

`legal/website-privacy.html` describes all of the above to visitors, in both
languages. **It is the site's counterpart to the rule the game policies live
under** — if what the site measures changes, that page is wrong and has to change
in the same commit.

## Editing content

Both game sections use the same markup, so a third game is a copy of one
`<article class="game">` block plus a `--accent` pair in the stylesheet:

```css
.game--ps { --accent: #ff5a52; --accent-2: #4a91ea; }
.game--cw { --accent: #ff8a2b; --accent-2: #ffc04d; }
```

Status pills, feature-card rules, glows and hover borders all read `--accent`, so
setting those two values is the whole theme for a section.

Paper Squadron's copy is kept in step with `store/play-games-listing.md` in the
game repo — if the Play listing changes, change it here too.

## Social links

The handles appear in more than one place, so change all of them together:

| Where | What |
| --- | --- |
| `index.html` — `.follow` block | labelled pills in the contact section |
| `index.html` + every legal page — `.social--compact` | icon buttons in the footer |
| `index.html` — JSON-LD `sameAs` | what search engines read |
| `index.html` — `twitter:site` / `twitter:creator` | share cards |

Current: [@voltix_studios](https://x.com/voltix_studios) on X,
[@VoltixStudiosGaming](https://www.youtube.com/@VoltixStudiosGaming) on YouTube,
[@voltixstudios](https://www.tiktok.com/@voltixstudios) on TikTok.

The icons are an inline `<symbol>` sprite at the top of each `<body>` (`#i-x`,
`#i-yt`, `#i-tt`, `#i-gh`, `#i-mail`, plus `#i-play` on the landing page) — no
icon font, no network request. The sprite is copied into every page, so adding a
network means editing every one of them. Each network keeps its own colour on hover only,
so the resting row stays monochrome and the studio palette still owns the page.

## Legal pages

`legal/paper-squadron/` holds the two documents Google Play requires: the privacy
policy and the account-deletion page. Both are published here in **English and
Spanish**, matching the languages the game ships in.

```
legal/paper-squadron/privacy-policy.html
legal/paper-squadron/delete-account.html
```

The wording is the same text previously served from Firebase Hosting
(`paper_ace/docs/`) — only the presentation changed, plus a Spanish translation of
the privacy policy, which had been English-only. **If the app's behaviour changes,
these pages have to change with it**: they describe what the code actually does,
and Play checks them.

Language is chosen before first paint by a small inline script in each page's
`<head>`, in this order: an explicit `?lang=en` / `?lang=es`, then the browser's
own preference. Nothing is written to storage — a page whose subject is what the
app keeps about you should not quietly keep something about you. With JavaScript
blocked the switch hides itself and **both** languages render in full, which is
the right fallback for a document a store has to be able to read.

> The two URLs are declared in the Play Console (Data safety form) and in
> `paper_ace/SETUP.md`. Both still point at the old Firebase Hosting addresses —
> switching them over to these pages is a Console edit, and needs no new build.

## Adding a game's legal pages

Copy `legal/paper-squadron/` to `legal/<game>/`, replace the copy, and set the
accent on `<main>`:

```html
<main id="main" class="doc--ps">   <!-- .doc--ps is defined in doc.css -->
```

Then add the new URLs to `sitemap.xml` and the footer's `.foot__links`.
