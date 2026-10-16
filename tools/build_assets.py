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

CW_TILES = ["basalt", "cinnabar", "cryolite", "pyrite", "nitre",
            "reinforced", "ledge", "coolant_cache", "crystals"]
# In the garage's order, common to legendary.
CW_DRONES = ["standard", "industrial", "scout", "miner", "stealth", "crystal", "hunter", "mecha",
             "ancient", "energy", "void", "core_guardian", "nova", "inferno", "celestial"]
# The store screenshots in screenshots/, in the order the page shows them.
CW_SHOTS = ["06-run-shaft-top", "07-run-fusion-burst", "09-run-overheat", "02-descent-map",
            "04-garage-legendary"]


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


def trim_alpha(im, pad=0.06):
    """Crop a transparent render to what is drawn, then centre it on a square.

    The hangar icons are rendered into a 512px frame with a lot of empty air
    around each craft, and not the same amount for each, so side by side in a
    grid they read as different sizes. Cropping to the alpha box and squaring
    puts every craft at the same fill.
    """
    box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if box:
        im = im.crop(box)
    side = round(max(im.size) * (1 + 2 * pad))
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return square


# Paper Squadron's in-flight screenshots, captured on the S21 on 24 September
# 2026 after the 1.7.0 art pass: Classroom Skies, Pirate Bay and Frost Peaks, in
# that order. The Desert Kingdom has no phone capture yet, so its picture on the
# page is the launch art instead. Listed rather than globbed: the folder holds
# thirty captures and the site shows three.
PS_SHOTS = ["Screenshot_20260924_094951_Paper Squadron.jpg",
            "Screenshot_20260924_100058_Paper Squadron.jpg",
            "Screenshot_20260924_100408_Paper Squadron.jpg"]

PS_PLANES = ["classic", "scout", "corsair", "frosthawk", "dunefalcon"]
PS_WINGMEN = ["recon", "bomber", "frostdrone", "deserthawk"]
PS_WORLDS = ["classroom", "piratebay", "frostpeaks", "desert"]


def build_paper_squadron(root):
    print("paper squadron")
    res = root / "Resources"
    save(trim_black(Image.open(res / "x_background.png").convert("RGBA")),
         "papersquadron-key.webp", width=1600)
    save(trim_black(Image.open(res / "initial_screen.png").convert("RGBA")),
         "papersquadron-poster.webp", width=900)

    # The hangar: the game's own shop icons, which 1.7.0 re-rendered from the
    # folded meshes. Only the craft the shop sells; SAND SCORPION and CARAVAN
    # GUARD are built but hidden until a world claims them.
    icons = root / "Assets/_Project/Resources/Icons"
    for prefix, out, names in [("plane", "ps-plane", PS_PLANES), ("wingman", "ps-wing", PS_WINGMEN)]:
        for name in names:
            src = icons / f"{prefix}_{name}.png"
            if not src.exists():
                print(f"  ! missing {src.name}")
                continue
            save(trim_alpha(Image.open(src).convert("RGBA")), f"{out}-{name}.webp", width=240)

    # The hub's world cards, one picture per world.
    worlds = root / "Assets/_Project/Resources/WorldArt"
    for name in PS_WORLDS:
        save(Image.open(worlds / f"{name}.png").convert("RGB"), f"ps-world-{name}.webp",
             width=720, quality=82)

    # The Desert Kingdom launch art, the same picture as the push notification.
    save(Image.open(root / "store/push/desert-kingdom-launch-1536x768.png").convert("RGB"),
         "ps-desert-kingdom.webp", width=1200, quality=84)

    for i, name in enumerate(PS_SHOTS, 1):
        save(Image.open(root / "screenshots" / name).convert("RGB"), f"ps-shot-{i}.webp",
             width=800, quality=80)


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

    # The block tiles the game draws the shaft with. crystals.png is the
    # artifact: the game uses the same picture for it on the home screen.
    art = root / "unity/Coreward/Assets/Resources/Art"
    for name in CW_TILES:
        save(Image.open(art / f"{name}.png").convert("RGBA"), f"cw-tile-{name}.webp", width=120)

    for name in CW_DRONES:
        save(Image.open(art / "Drones" / f"{name}.png").convert("RGBA"), f"cw-drone-{name}.webp",
             width=180)

    for i, name in enumerate(CW_SHOTS, 1):
        save(Image.open(root / "screenshots" / f"{name}.png").convert("RGB"), f"cw-shot-{i}.webp",
             width=540, quality=82)


def build_dungeon_gourmand(root):
    print("dungeon gourmand")
    logos = root / "logos"
    # These two are full-bleed painted scenes rather than a logo on a matte, so
    # neither trim_black nor black_to_alpha applies — cropping a lit scene to
    # its bbox is a no-op, and keying it would eat the artwork's own shadows.
    save(Image.open(logos / "dungeon_gourmand_key_art.png").convert("RGB"),
         "dungeongourmand-key.webp", width=1600)
    save(Image.open(logos / "dungeon_gourmand_mark.png").convert("RGB"),
         "dungeongourmand-poster.webp", width=760)


def build_loom(root):
    print("loom")
    # Loom's mark is drawn, not painted: android/tools/make-icons.py in the game's
    # own repository writes store/key-1024.png from the same three thread colours
    # the game uses. Nothing to trim or key here; it is already exact.
    tile = Image.open(root / "store" / "key-1024.png").convert("RGBA")
    save(tile, "loom-key.webp", width=900)
    save(tile, "loom-icon.webp", width=192)

    # The store screenshots, which already carry their own headline and a phone
    # frame, so the site shows them as they are rather than captioning them again.
    shots = sorted((root / "store" / "screenshots").glob("*.png"))
    if not shots:
        print("  ! no screenshots in store/screenshots")
    for i, src in enumerate(shots, 1):
        save(Image.open(src).convert("RGB"), f"loom-shot-{i}.webp", width=540, quality=82)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--logo", type=Path, default=Path.home() / "voltix_studios/logos/voltix_logo_1.png")
    ap.add_argument("--paper", type=Path, default=Path.home() / "voltix_studios/PaperSquadron")
    ap.add_argument("--coreward", type=Path, default=Path.home() / "voltix_studios/CoreWard")
    ap.add_argument("--gourmand", type=Path,
                    default=Path.home() / "voltix_studios/DungeonGourmand")
    ap.add_argument("--loom", type=Path, default=Path.home() / "voltix_studios/Loom")
    ap.add_argument("--only", nargs="*", choices=["logo", "paper", "coreward", "gourmand", "loom"],
                    help="rebuild only these; the other source roots need not exist")
    args = ap.parse_args()

    builders = [("logo", args.logo, build_voltix), ("paper", args.paper, build_paper_squadron),
                ("coreward", args.coreward, build_coreward),
                ("gourmand", args.gourmand, build_dungeon_gourmand), ("loom", args.loom, build_loom)]
    if args.only:
        builders = [b for b in builders if b[0] in args.only]

    for label, path, _ in builders:
        if not path.exists():
            sys.exit(f"--{label} not found: {path}")

    for _, path, build in builders:
        build(path)
    print(f"\nwrote {len(list(OUT.iterdir()))} files to {OUT.relative_to(REPO)}/")


if __name__ == "__main__":
    main()
