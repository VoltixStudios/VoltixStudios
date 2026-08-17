#!/usr/bin/env python3
"""Regenerate the Play Store QR code shown in the Paper Squadron section.

The QR is a committed SVG rather than something the page builds at runtime — the
site loads no third-party JavaScript and the URL it encodes never changes:

    python3 tools/build_qr.py

Requires OpenCV (`pip install opencv-python`), which both encodes and reads QR
codes, so the script checks its own output before writing it. A QR that scans to
the wrong address looks perfectly fine in review, which is exactly why the check
is here rather than left to whoever notices.
"""

import sys
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover
    sys.exit("OpenCV is required: pip install opencv-python")

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "assets" / "img"

# What the committed SVG encodes. This constant is the record of it — the image
# itself is unreadable by eye, so nothing else in the repo can play that role.
PLAY_URL = "https://play.google.com/store/apps/details?id=com.voltixstudios.papersquadron"

# The spec's minimum, and what scanners are tuned for. Without it a QR sitting
# on a coloured card is unreliable.
QUIET_ZONE = 4


def encode(url):
    """Return the QR as a 2-D bool array, True where a module is dark."""
    matrix = cv2.QRCodeEncoder_create().encode(url)
    return matrix == 0


def to_svg(modules, url):
    """Draw the module grid as one path of merged horizontal runs.

    A <rect> per dark module is the obvious way and produces a file roughly ten
    times larger; runs of adjacent modules collapse into a single subpath for
    free, because a QR is mostly horizontal streaks.
    """
    size = len(modules) + QUIET_ZONE * 2
    runs = []
    for y, row in enumerate(modules):
        x = 0
        while x < len(row):
            if not row[x]:
                x += 1
                continue
            start = x
            while x < len(row) and row[x]:
                x += 1
            runs.append(f"M{start + QUIET_ZONE} {y + QUIET_ZONE}h{x - start}v1h-{x - start}z")

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'shape-rendering="crispEdges" role="img">\n'
        f"  <title>{url}</title>\n"
        f'  <rect width="{size}" height="{size}" fill="#fff"/>\n'
        f'  <path fill="#05070e" d="{"".join(runs)}"/>\n'
        f"</svg>\n"
    )


def verify(modules, url):
    """Read the grid back the way a scanner would, and fail loudly if it differs.

    Decoding the module array directly is too kind to it — a phone reads pixels.
    Scaling up and padding reproduces enough of that to catch a real mistake.
    """
    img = np.where(modules, 0, 255).astype(np.uint8)
    img = cv2.resize(img, (img.shape[1] * 8, img.shape[0] * 8), interpolation=cv2.INTER_NEAREST)
    pad = QUIET_ZONE * 8
    img = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=255)

    decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    if decoded != url:
        sys.exit(f"QR does not read back correctly:\n  wanted {url!r}\n  got    {decoded!r}")


def main():
    modules = encode(PLAY_URL)
    verify(modules, PLAY_URL)

    dest = OUT / "ps-play-qr.svg"
    dest.write_text(to_svg(modules, PLAY_URL), encoding="utf-8")
    print(f"ps-play-qr.svg  {len(modules)}x{len(modules)} modules, "
          f"{dest.stat().st_size / 1024:.1f} kB")
    print(f"  -> {PLAY_URL}")


if __name__ == "__main__":
    main()
