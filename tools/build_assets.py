#!/usr/bin/env python3
"""Regenerate the site's images from the source art in the game repos.

The originals are multi-megabyte PNGs living outside this repo; the site ships
trimmed, resized WebP. Run this whenever a logo or a piece of key art changes:

    python3 tools/build_assets.py                 # default source roots
    python3 tools/build_assets.py --paper ~/x     # override one

Requires Pillow (`pip install pillow`). Nothing else in the site depends on it —
the generated files under assets/img/ are committed.
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "assets" / "img"

# Panel boundaries measured off CoreWard's images/backgrounds.png strata strip.
# They are not evenly spaced, so they are listed rather than computed.
STRATA_BOUNDS = [(22, 191), (191, 384), (384, 579), (579, 784), (784, 997)]
STRATA_ROWS = (52, 653)
STRATA_NAMES = ["topsoil", "sediment", "igneous", "crystalline", "core"]


def trim_black(im, threshold=14, pad=0.04):
    """Crop away the flat black matte these logos are rendered on.

    `pad` puts a fraction of the trimmed size back as margin — a bbox-tight crop
    leaves the tagline sitting on the very edge of the frame, which reads as a
    mistake once the image is in a card.
    """
    grey = im.convert("RGB").convert("L").point(lambda p: 255 if p > threshold else 0)
    box = grey.getbbox()
    if not box:
        return im
    left, top, right, bottom = box
    m = round(max(right - left, bottom - top) * pad)
    return im.crop((max(0, left - m), max(0, top - m),
                    min(im.width, right + m), min(im.height, bottom + m)))


def black_to_alpha(im):
    """Turn a black-matted render into one with a real alpha channel.

    The logos are lit artwork composited on black, so the matte cannot be keyed
    out by colour — the glow fades continuously into it. Treating the image as
    if it had been screened over black recovers the alpha exactly: take alpha
    from the brightest channel, then unpremultiply the colour. The result sits
    on any background without the faint rectangle a blend mode leaves behind.

    Unpremultiplying divides by alpha, which amplifies noise in the
    near-transparent pixels into something WebP cannot compress — the file grew
    ten-fold before this was bounded. Below FLOOR the pixels are invisible
    anyway, so their original (near-black) colour is kept.
    """
    import numpy as np

    FLOOR = 8

    a = np.asarray(im.convert("RGBA"), dtype=np.float32)
    rgb, alpha = a[..., :3], a[..., :3].max(axis=2)
    lifted = np.clip(rgb * 255.0 / np.maximum(alpha, 1.0)[..., None], 0, 255)
    rgb = np.where((alpha >= FLOOR)[..., None], lifted, rgb)
    return Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), "RGBA")


def save(im, name, width=None, quality=86, lossless=False):
    if width and im.width > width:
        height = round(im.height * width / im.width)
        im = im.resize((width, height), Image.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    if path.suffix == ".png":
        im.save(path, optimize=True)
    else:
        im.save(path, quality=quality, method=6, lossless=lossless)
    print(f"  {name:34s} {im.width:5d}x{im.height:<5d} {path.stat().st_size / 1024:7.1f} KB")
    return im


def build_voltix(logo_path):
    print("voltix")
    src = Image.open(logo_path).convert("RGBA")
    # These two go on the page background rather than in a frame, so they carry
    # transparency; the game key art below stays matted, framed inside a card.
    save(black_to_alpha(trim_black(src)), "voltix-lockup.webp", width=1000)

    # The emblem alone, for the header and the favicon. The wordmark sits under
    # the mark, so take the square region above it.
    w, h = src.size
    mark = black_to_alpha(
        trim_black(src.crop((int(w * 0.14), int(h * 0.06), int(w * 0.86), int(h * 0.70))), pad=0.02))
    side = max(mark.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    save(square, "voltix-mark.webp", width=256)
    save(square.resize((32, 32), Image.LANCZOS), "favicon-32.png")

    # iOS composites a touch icon onto whatever it likes, so give it its own
    # background rather than shipping transparency.
    touch = Image.new("RGB", (180, 180), (5, 6, 10))
    icon = square.resize((150, 150), Image.LANCZOS)
    touch.paste(icon, (15, 15), icon)
    save(touch, "apple-touch-icon.png")

    # Link-preview card. PNG rather than WebP: some scrapers still refuse WebP.
    card = Image.new("RGB", (1200, 630), (5, 6, 10))
    lockup = black_to_alpha(trim_black(src))
    lockup.thumbnail((760, 470), Image.LANCZOS)
    card.paste(lockup, ((1200 - lockup.width) // 2, (630 - lockup.height) // 2), lockup)
    save(card, "og-card.png")


def build_paper_squadron(root):
    print("paper squadron")
    res = root / "Resources"
    save(trim_black(Image.open(res / "x_background.png").convert("RGBA")),
         "papersquadron-key.webp", width=1600)
    save(trim_black(Image.open(res / "initial_screen.png").convert("RGBA")),
         "papersquadron-poster.webp", width=900)

    icons = root / "Assets/_Project/Resources/Icons"
    for name in ["classic", "swift", "falcon", "corsair", "scout", "seeker", "brick", "frosthawk"]:
        src = icons / f"plane_{name}.png"
        if not src.exists():
            print(f"  ! missing {src.name}")
            continue
        save(Image.open(src).convert("RGBA"), f"ps-plane-{name}.webp", width=128, lossless=True)


def build_coreward(root):
    print("coreward")
    img = root / "images"
    save(trim_black(Image.open(img / "screen_grafico.png").convert("RGBA")),
         "coreward-key.webp", width=1600)
    save(Image.open(img / "initial_screen.png").convert("RGB"), "coreward-poster.webp", width=760)
    save(Image.open(img / "home.png").convert("RGB"), "coreward-home.webp", width=560)

    strata = Image.open(img / "backgrounds.png").convert("RGB")
    top, bottom = STRATA_ROWS
    for name, (left, right) in zip(STRATA_NAMES, STRATA_BOUNDS):
        save(strata.crop((left, top, right, bottom)), f"cw-strata-{name}.webp", width=240)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--logo", type=Path, default=Path.home() / "voltix_studios/logos/voltix_logo_1.png")
    ap.add_argument("--paper", type=Path, default=Path.home() / "paper_ace")
    ap.add_argument("--coreward", type=Path, default=Path.home() / "voltix_studios/CoreWard")
    args = ap.parse_args()

    for label, path in [("logo", args.logo), ("paper", args.paper), ("coreward", args.coreward)]:
        if not path.exists():
            sys.exit(f"--{label} not found: {path}")

    build_voltix(args.logo)
    build_paper_squadron(args.paper)
    build_coreward(args.coreward)
    print(f"\nwrote {len(list(OUT.iterdir()))} files to {OUT.relative_to(REPO)}/")


if __name__ == "__main__":
    main()
