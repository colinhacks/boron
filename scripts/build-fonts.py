#!/usr/bin/env python3
"""Builds the woff2 faces in src/assets/fonts/ from a Nerd Fonts release.

    pip install 'fonttools[woff]' brotli
    python3 scripts/build-fonts.py

Boron ships JetBrains Mono patched by Nerd Fonts rather than the Google-Fonts
subsets it used to, for two reasons that turn out to be the same reason: Google
strips box-drawing, arrows and dingbats out of every subset it publishes, and
Nerd Fonts adds ~10,000 icons on top of a font that already has them. Terminal
output is made of both. Before this, every one of those characters was laid out
against whatever monospace font the reader's OS supplied — so the same document
rendered at different widths on macOS and Windows, and an exported SVG carried
none of them.

Three properties of the patched font are what make it a drop-in, and all three
were measured rather than assumed (see wiki/fonts.md):

  * Every one of its 12,121 mapped codepoints advances exactly 0.600 em, which
    is already Boron's invariant. Layout does not change. This is why the *Mono*
    variant is the one to patch from — plain `NerdFont` is nearly identical but
    `NerdFontPropo` is proportional and would break it.
  * The icon glyphs are byte-identical across all four weights — the patcher
    inserts the same outlines into each. Of the 1,004 codepoints whose outlines
    genuinely vary by weight, not one is in the icon range. So the icons ship
    once and are shared by every weight and style, rather than four times.
  * The split needs no editorial judgement: the icons are in the Private Use
    Area, which is precisely where a font patcher is allowed to put them.

So there are two families. `Boron Mono` is four faces carrying everything
outside the PUA — latin, latin-ext, Cyrillic, Greek, and every symbol block a
terminal emits — and is always loaded, at 190 KB for the four. `Boron Icons` is
one face carrying the PUA, and is fetched only when a document actually contains
one of its codepoints; it is 4.6x the size of all four text faces put together
and most screenshots have no icon in them at all.

Splitting on the PUA rather than on "U+E000 and up" matters more than it looks.
The patched font maps about fifty non-icon glyphs above U+E000 — the ℂ ℍ ℕ
double-struck letters, a handful of fullwidth forms, and U+FFFD, the replacement
character you get for undecodable bytes. Lumping those in with the icons would
make a single `�` in a paste pull down a megabyte.

A hand-picked list of "the blocks terminals actually emit" was tried first for
the text faces and came to 161 KB — 29 KB less, in exchange for a range table
someone has to keep justifying and a standing supply of bug reports from anyone
whose output is Greek.
"""

import io
import os
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.ttLib.woff2 import compress
except ImportError:
    sys.exit("needs fonttools: pip install 'fonttools[woff]' brotli")

NERD_FONTS_VERSION = "v3.5.0"
ARCHIVE_URL = (
    f"https://github.com/ryanoasis/nerd-fonts/releases/download/{NERD_FONTS_VERSION}/JetBrainsMono.tar.xz"
)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "assets" / "fonts"

# The four faces Boron renders with, as (source suffix, weight, style).
FACES = [
    ("Regular", "400", "normal"),
    ("Italic", "400", "italic"),
    ("Bold", "700", "normal"),
    ("BoldItalic", "700", "italic"),
]

# The Private Use Area, in all three of its blocks. Keep this in step with
# ICON_RANGES in src/export/fonts.ts — the app decides whether to fetch the icon
# face by testing the same boundaries this file subsets on.
PUA_RANGES = [
    (0xE000, 0xF8FF),  # BMP private use
    (0xF0000, 0xFFFFD),  # supplementary private use area-A
    (0x100000, 0x10FFFD),  # supplementary private use area-B
]


def is_icon(codepoint: int) -> bool:
    return any(lo <= codepoint <= hi for lo, hi in PUA_RANGES)


def fetch_faces(work: Path) -> None:
    """Unpack the four source .ttf files, downloading the release if needed."""
    wanted = {f"JetBrainsMonoNerdFontMono-{suffix}.ttf" for suffix, _, _ in FACES}
    if all((work / name).exists() for name in wanted):
        print(f"  using the copies already in {work}")
        return

    print(f"  downloading Nerd Fonts {NERD_FONTS_VERSION}...")
    with urllib.request.urlopen(ARCHIVE_URL) as response:
        payload = response.read()
    work.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:xz") as archive:
        for member in archive.getmembers():
            if member.name in wanted or member.name in {"OFL.txt", "README.md"}:
                archive.extract(member, work)


def build(source: Path, codepoints: list[int], destination: Path) -> int:
    """Subset `source` to `codepoints` and write it out as woff2.

    Compression is a separate step on purpose. fontTools can emit woff2 straight
    out of the subsetter, but it skips the glyf transform when it does and the
    result is roughly twice the size — which reads as "subsetting made it
    bigger" and is easy to mistake for a bad range list.
    """
    font = TTFont(source)
    options = subset.Options()
    # Hinting is ~30% of the file and Boron only ever renders at 15px on a
    # display that hints its own way, or into a 2x raster where it is moot.
    options.hinting = False
    options.glyph_names = False
    options.notdef_outline = True
    options.drop_tables += ["PfEd", "TeX"]

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)

    scratch = destination.with_suffix(".ttf")
    font.save(scratch)
    compress(scratch, destination)
    scratch.unlink()
    return destination.stat().st_size


def main() -> None:
    work = Path(os.environ.get("BORON_FONT_WORK_DIR", "/tmp/boron-nerd-fonts"))
    work.mkdir(parents=True, exist_ok=True)
    fetch_faces(work)
    OUT.mkdir(parents=True, exist_ok=True)

    covered = set(TTFont(work / "JetBrainsMonoNerdFontMono-Regular.ttf", lazy=True).getBestCmap())
    text = sorted(c for c in covered if not is_icon(c))
    icons = sorted(c for c in covered if is_icon(c))

    print(f"\ntext faces ({len(text)} codepoints):")
    total = 0
    for suffix, weight, style in FACES:
        out = OUT / f"boron-mono-{weight}-{style}.woff2"
        size = build(work / f"JetBrainsMonoNerdFontMono-{suffix}.ttf", text, out)
        total += size
        print(f"  {out.name:<32} {size / 1024:7.1f} KB")

    print(f"\nicon face ({len(icons)} codepoints, shared by every weight):")
    out = OUT / "boron-icons.woff2"
    icon_size = build(work / "JetBrainsMonoNerdFontMono-Regular.ttf", icons, out)
    print(f"  {out.name:<32} {icon_size / 1024:7.1f} KB")

    for name in ("OFL.txt", "README.md"):
        source = work / name
        if source.exists():
            shutil.copyfile(source, OUT / ("LICENSE.txt" if name == "OFL.txt" else "UPSTREAM.md"))

    print(f"\n  eager (four text faces): {total / 1024:.1f} KB")
    print(f"  lazy  (icons, on demand): {icon_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
