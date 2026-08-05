#!/usr/bin/env bash
# Renders logo-concepts/og-card.html into public/og.png at 2400x1260 (2x of the
# 1200x630 card), which is what index.html points og:image and twitter:image at.
#
# A browser rather than rsvg-convert, because the card is set in JetBrains Mono
# and that font lives in node_modules as a woff2. rsvg-convert goes through
# fontconfig, finds no system copy, and silently substitutes a generic mono.
#
# Requires Google Chrome. Serves the repo root so the @font-face URL resolves.
set -euo pipefail

cd "$(dirname "$0")/.."

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME" >&2; exit 1; }

PORT=8731
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT

# Wait for the server rather than sleeping a fixed amount.
for _ in $(seq 1 40); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/logo-concepts/og-card.html" && break
  sleep 0.1
done

"$CHROME" \
  --headless \
  --disable-gpu \
  --hide-scrollbars \
  --window-size=1200,630 \
  --force-device-scale-factor=2 \
  --virtual-time-budget=4000 \
  --screenshot="$PWD/public/og.png" \
  "http://127.0.0.1:$PORT/logo-concepts/og-card.html" >/dev/null 2>&1

echo "  public/og.png  $(file -b --mime-type public/og.png), $(sips -g pixelWidth -g pixelHeight public/og.png | awk '/pixel/{printf "%s ", $2}')"
