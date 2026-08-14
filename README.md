# voltix_studios.github.io

The Voltix Studios website — a single static page covering the studio and its two
games, **Paper Squadron** and **CoreWard**.

Live at <https://oriolorragit.github.io/voltix_studios.github.io/>.

> The repository is owned by `oriolorragit`, so GitHub serves this as a *project*
> page and the URL carries the repo name. To get the bare `oriolorragit.github.io`
> address instead, rename the repository to `oriolorragit.github.io`; to use a
> domain of your own, add a `CNAME` file. Every path in the page is relative, so
> either move works without editing the HTML.

## Layout

```
index.html          the whole page
assets/css/style.css
assets/js/main.js   sticky header, scroll reveal, scroll-spy — all optional
assets/img/         generated, committed
tools/build_assets.py
```

There is no build step. Edit, commit, push; GitHub Pages serves it as-is.

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

## Preview locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

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
