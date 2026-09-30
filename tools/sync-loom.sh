#!/usr/bin/env bash
# Puts Loom's daily cloth on the site, at /loom/play/.
#
#   bash tools/sync-loom.sh                    reads the game from ../Loom
#   LOOM=/path/to/Loom bash tools/sync-loom.sh
#
# The game is one HTML file in the Loom repository (game/index.html), and that
# file stays the only place it is edited. This copies it here and adds to the
# copy, and to nothing else:
#   - window.LoomWeb, which switches the game into its website mode (WEB in the
#     game): today's cloth only, no archive, no quilt, no reminder, nothing sent
#     to Google, no day counters, and a shared result that links back here;
#   - a description, a canonical link, an icon and a link preview;
#   - the site's Umami tag, with the website id read from index.html so that it
#     is set in one place.
# Run it after any change to the game that should reach the site, then commit
# loom/play/. Nothing is live until the push.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
LOOM="${LOOM:-$HERE/../Loom}"
SRC="$LOOM/game/index.html"
OUT="$HERE/loom/play"
[ -f "$SRC" ] || { echo "no game at $SRC - set LOOM to the Loom repository" >&2; exit 1; }

ID="$(grep -o 'data-website-id="[^"]*"' "$HERE/index.html" | head -n 1 | cut -d'"' -f2)"
[ -n "$ID" ] || { echo "no data-website-id in index.html" >&2; exit 1; }

# The commit the game file comes from, marked if the file itself has uncommitted
# edits. Only the game counts: other files in the Loom tree do not reach the copy.
REV="$(git -C "$LOOM" log -1 --format=%h -- game/index.html 2>/dev/null || true)"
[ -n "$REV" ] || REV=unknown
git -C "$LOOM" diff --quiet HEAD -- game/index.html 2>/dev/null || REV="$REV-modified"

mkdir -p "$OUT"
python3 - "$SRC" "$OUT/index.html" "$ID" "$REV" <<'PY'
import sys
src, out, umami_id, rev = sys.argv[1:5]
s = open(src, encoding="utf-8").read()

def once(anchor, new):
    global s
    if s.count(anchor) != 1:
        sys.exit("anchor not found exactly once in the game: " + anchor)
    s = s.replace(anchor, new)

URL = "https://voltixstudios.pages.dev/loom/play/"
DESC = ("Loom, the daily pattern puzzle by Voltix Studios. Today's cloth, free in the "
        "browser: the same one for everyone, five attempts.")

once("<title>Loom — daily pattern</title>", f"""<title>Loom — today's cloth</title>
<!-- Copied from the Loom repository (game/index.html at {rev}) by
     tools/sync-loom.sh. Edit the game there and run the script again; an edit
     made here is lost on the next copy. -->
<meta name="description" content="{DESC}">
<link rel="canonical" href="{URL}">
<link rel="icon" href="icon-512.png">
<link rel="apple-touch-icon" href="icon-512.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Voltix Studios">
<meta property="og:title" content="Loom — today's cloth">
<meta property="og:description" content="{DESC}">
<meta property="og:url" content="{URL}">
<meta property="og:image" content="{URL}icon-512.png">
<meta property="og:image:width" content="512">
<meta property="og:image:height" content="512">
<!-- The website mode: see WEB in the game. `more` is relative so that it also
     resolves on the github.io mirror. -->
<script>window.LoomWeb={{share:'{URL}',more:'../../games/loom/'}};</script>""")

once("</body>", f"""<!-- /analytics/ is the site's Pages Function proxying Umami (legal/website-privacy.html).
     Root-absolute on purpose: it resolves only on Cloudflare. -->
<script defer src="/analytics/script.js"
        data-website-id="{umami_id}"
        data-exclude-hash="true"></script>
</body>""")

open(out, "w", encoding="utf-8").write(s)
PY
cp "$LOOM/game/logo.png" "$OUT/logo.png"
cp "$LOOM/store/icon-512.png" "$OUT/icon-512.png"
echo "loom/play/ written from $SRC"
