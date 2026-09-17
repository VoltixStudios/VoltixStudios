# Loom's day counters — turning them on

The code is written and tested. Nothing is live until the President does the
steps below, and nothing in the game speaks to anybody until step 6.

The account is `f4a18597b49ce5c747234761807a420a`, the Pages project is the one
already serving this site.

---

## 1. Create the database

Dashboard → **Storage & Databases → D1 SQL Database → Create database**.

- **Name:** `loom`
- **Location:** leave it automatic.

Or from a terminal, once, in this repository:

```
npx wrangler login
npx wrangler d1 create loom
```

## 2. Create the tables

```
npx wrangler d1 execute loom --remote --file functions/loom/schema.sql
```

If the terminal is not convenient: dashboard → the `loom` database → **Console**,
paste the contents of `functions/loom/schema.sql`, run it. It is safe to run
twice; every statement says `IF NOT EXISTS`.

## 3. Bind the database to the site

Dashboard → **Workers & Pages → voltixstudios → Settings → Bindings** (or
*Functions → D1 database bindings* on the older screen) → **Add binding**.

- **Variable name:** `LOOM` — exactly that, in capitals. The function looks for
  `env.LOOM` and answers `503` with `{"error":"no store"}` if it is missing.
- **D1 database:** `loom`
- Add it to **Production**, and to **Preview** as well if you want branch
  deploys to work.

A binding only reaches the site on the *next* deploy, so push something —
step 4's commit will do.

## 4. Deploy

Commit and push this repository. Pages picks `functions/loom/scores.js` up by
path, the way it already does with `functions/analytics/`. There is no build
step and no `wrangler.toml`.

## 5. Check it with your own hands

`259` below is Loom's day number for 17 September 2026 — days since
1 January 2026. Only yesterday, today and tomorrow are accepted.

```
# nobody has played yet
curl -s "https://voltixstudios.pages.dev/loom/scores?d=259"

# a result: day 259, solved in 3 attempts, 95 seconds, a made-up key
curl -s -X POST https://voltixstudios.pages.dev/loom/scores \
  -H 'Content-Type: application/json' \
  -d '{"d":259,"a":3,"s":95,"k":"aaaaaaaaaaaaaaaa"}'
```

The first answers with zeros, the second with `"rank":1` and a `1` in the third
bucket of `solved`. Send the same body twice: the counts must not move. To see
all of that locally before any of it is live, run `bash functions/loom/test.sh`.

## 6. Turn it on in the game

In the Loom repository, `game/index.html`:

```js
const SCORES={url:'',min:20};
```

becomes

```js
const SCORES={url:'https://voltixstudios.pages.dev/loom/scores',min:20};
```

then `bash check.sh`, `bash android/build.sh`, and it ships with the next build.
Empty is the off switch, so until that line changes the game talks to nobody —
including every build already on a phone.

## 7. Before that build is uploaded

Two things must be true **before** a build that sends anything reaches Play:

- the **privacy policy** says the game sends the day number, the number of
  attempts and how long it took to Voltix Studios' own server, and that no
  account, name, device id or advertising id goes with it;
- the **Play Data safety** form says the same. The answer to "is data linked to
  the user's identity" is no, and it is no because there is nothing to link it
  with.

## What this costs

Nothing at any volume this studio will see for a long time. D1's free plan is
5 GB, 5 million rows read a day and 100 000 written; one player finishing one
day is one row read and two written. A thousand players a day is about 2 000
writes.

## What is stored, in full

One row per puzzle day, holding counts: how many people solved it in one
attempt, in two … in six, how many did not solve it, and how many finished
inside each of six time bands. Counts, not people. No account, no name, no IP
address, no advertising id, no cloth, no order of operations.

The one per-device thing is a check against counting the same phone twice: the
phone makes up a random number once and keeps it; what is stored is
`sha256(day + ":" + number)`, never the number, and those rows are deleted after
a week. Because the day is inside the hash and the number has 96 bits in it,
two days' hashes from one phone cannot be tied together by anybody holding the
table.

## If you want a rate limit as well

Dashboard → the site → **Security → WAF → Rate limiting rules** (one rule is
free): if the URI path equals `/loom/scores` and the method is `POST`, allow
say 20 requests per minute per IP, then block for a minute. It is not needed
for correctness — the double-count guard is what protects the numbers — but it
keeps a bored person from filling the table.
