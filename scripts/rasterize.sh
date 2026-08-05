#!/usr/bin/env bash
# Rasterizes the SVG sources in public/ into every PNG the site needs.
# Requires rsvg-convert (brew install librsvg) and ImageMagick for the .ico.
set -euo pipefail

cd "$(dirname "$0")/../public"

png() { rsvg-convert -w "$2" -h "$3" "$1" -o "$4"; echo "  $4  ${2}x${3}"; }

echo "icons:"
png mark.svg      192  192 icon-192.png
png mark.svg      512  512 icon-512.png
png mark.svg      180  180 apple-touch-icon.png
png favicon.svg    48   48 favicon-48.png
png favicon.svg    32   32 favicon-32.png
png favicon.svg    16   16 favicon-16.png

echo "social:"
# og.png is not built here — it needs JetBrains Mono, which rsvg-convert cannot
# resolve. Run scripts/render-og.sh for that one.

echo "ico:"
# Multi-resolution .ico for legacy Windows/Edge and anything that ignores SVG.
magick favicon-16.png favicon-32.png favicon-48.png favicon.ico && echo "  favicon.ico  16+32+48"
rm -f favicon-16.png favicon-32.png favicon-48.png

echo
echo "done."
