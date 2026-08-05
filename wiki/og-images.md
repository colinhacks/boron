# Rendering a share link's image on the server

A design sketch, not a built feature. The goal: paste a Boron link into Slack, Twitter, Discord or iMessage and have the unfurl show *that terminal block*, rendered server-side, rather than the one static card everybody gets today.

Two things have to be true for it to work, and neither is true right now. Both are written up here with what was actually measured.

## Blocker 1 — the payload is in the fragment, and the server never sees it

Share links are `boron.sh/#s=<payload>`. A URL fragment is stripped by the browser before the request goes out: it never reaches Vercel, never appears in a log, and is never sent to a crawler. That is exactly why the fragment was chosen ([architecture.md](architecture.md) — the payload stays off every server that handles the link), and it is also precisely what makes server-side rendering impossible as things stand.

Crawlers make it worse: Slack, Twitter and the rest fetch the URL and read `<meta>` tags out of the HTML. They do not run JavaScript. So even a client that could render the card has no way to put it in front of them.

**The fix is a path form:** `boron.sh/s/<payload>`. A path is sent to the server, caches cleanly at the edge, and reads better than a query string. `shareParamFrom` in [src/workspace.ts](../src/workspace.ts) already accepts `?s=` as well as `#s=`, so adding a third source is small. Keep `#s=` decoding forever — links already in the wild must not break — but emit the path form from `buildShareUrl`.

That gives two routes:

| Route | Returns |
| --- | --- |
| `GET /s/<payload>` | The app shell, with `og:image` pointed at the image route and an `og:title`/`og:description` derived from the payload |
| `GET /og/<payload>.png` | The rendered PNG |

## Blocker 2 — layout needs a browser, and the bundled font is latin-only

`computeLayout` in [src/export/layout.ts](../src/export/layout.ts) measures every span with `CanvasRenderingContext2D.measureText`, and derives half-leading from `fontBoundingBoxAscent`/`Descent`. There is no canvas on a serverless runtime.

Measuring what the browser actually does turns this from a problem into an opportunity. At `FONT_SIZE = 15`:

- Every glyph **that comes from the bundled font** advances exactly `9px` — `0.6 × fontSize`, identical across all four faces (regular, bold, italic, bold-italic).
- Measurement is exactly additive: `measureText("$ npm run build --workspace=@acme/app")` minus `length × 9` is **0.000px**.

So for text the app actually ships a font for, layout needs no rasterizer at all — it is `length × 0.6 × fontSize`. But:

- **The bundled font is latin-only.** [src/export/fonts.ts](../src/export/fonts.ts) imports four `jetbrains-mono-latin-*.woff2` files, and `@fontsource/jetbrains-mono` ships only the Google-Fonts subsets (latin, latin-ext, cyrillic, cyrillic-ext, greek, vietnamese). Google strips box-drawing, arrows and dingbats out of all of them.
- **So terminal output falls back to a system font.** Measured against a deliberately absent family to force fallback: `M`, `0` and `é` come from the bundled font at `9.000px`, while `─ │ ╭ ➜ ✓ ✗ ⚠ █` every one measure `9.031px` — byte-identical to the no-font-available case. `🚀` is `19px` and `中` is `15.3px`, both from fallback too. (`document.fonts.check()` returns `true` for all of them; it reports whether *some* font in the stack can render, not whether the first one has the glyph. Measure, don't ask.)

**This is a live defect in the promise share links already make.** The sample document itself contains `➜`, `✓`, `✗` and `⚠`. Those glyphs are laid out using whatever monospace font the reader's OS supplies, so the same link renders at different widths on macOS and on Windows — and an exported SVG has the same gap, because `embeddedFontCss` inlines only the four latin faces. The config travels; the fonts do not.

**One fix closes both.** Self-host the upstream JetBrains Mono release (from JetBrains, not the Google-Fonts subsets — the upstream font does contain box-drawing and arrows), then replace the canvas measurement with a pure function:

- `charWidth = FONT_SIZE * 0.6`, exactly.
- Width is a per-codepoint sum, `1` for ordinary cells and `2` for the wide ranges (CJK, emoji) — which is `wcwidth`, the same rule a real terminal uses to decide how many cells a glyph occupies. Arguably more correct than asking Canvas2D.
- Ascent and descent become constants read once from the font's own metrics rather than from `measureText`.

Layout then runs anywhere, is identical on client and server, and — the part that matters most — is finally identical *across browsers*, which is what the share link claimed all along.

## Rendering, once layout is pure

`renderToSvg` in [src/export/svg.ts](../src/export/svg.ts) is already string building rather than DOM work, so with a pure layout the whole pipeline runs on a server: decode the payload → sanitize → `documentToRenderLines` → `computeLayout` → `renderToSvg`.

OG cards will not accept SVG, so it has to be rasterized. `@resvg/resvg-wasm` is the fit: WASM, takes an SVG string and font buffers, returns PNG bytes, and keeps our own renderer as the source of truth.

**Rejected: `@vercel/og` / Satori.** It does its own text layout from JSX. Using it would mean maintaining a second description of the block and accepting that the card is *similar to* rather than *the same as* what the app draws — which throws away the pixel-identity the rest of this design is spent buying.

Unverified, and worth a spike before committing: whether the resvg WASM binary fits inside Vercel's Edge Function bundle limit. If it does not, the same code runs in the Node runtime with `resvg-js` — colder starts, but the caching below makes cold starts nearly irrelevant.

## Caching — the part that comes out well

**The payload is a content hash.** Same payload, same image, forever; there is no such thing as a stale render. That is the ideal shape for a CDN:

```
Cache-Control: public, max-age=31536000, immutable
```

Vercel's edge caches by full path, so `/og/<payload>.png` is a natural cache key and the function runs **once per distinct link, ever**. Crawlers help rather than hurt here — Slack, Twitter and Discord each fetch independently, and every fetch after the first is a pure CDN hit.

Because entries are immutable and content-addressed there is no invalidation problem. A change to the renderer leaves already-shared links rendering as they did when they were shared, which is a feature. If a rendering fix genuinely must reach old links, bump a segment — `/og/v2/<payload>.png` — rather than purging.

## The edges

- **URL length.** A rich eleven-line block encodes to ~700 characters, which is nothing; a large paste is not. Request-line and header limits are finite, so `/s/<payload>` should degrade rather than fail: above a threshold, serve the static `/og.png` and let the app load the state from the fragment as it does today. The link still works, it just does not get a custom card.
- **The card is not the image.** OG cards want a fixed aspect ratio (the current one is 2400×1260). A tall block should be rendered onto that canvas — centred, scaled to fit, on the backdrop — rather than emitted at its natural size. That is a compositing step on top of the scene, not a change to it.
- **Payloads are attacker-written.** The route must go through the same `sanitize*` functions the client uses, and cap decompressed size and line count — the client's exposure is your own tab, a server's exposure is everyone's.
- **`og:title`.** Derivable from the payload for free: the window title if the frame has one, else the first command line. Worth doing; it is the difference between "Boron" and "$ npm run build" in the unfurl.

## Rough shape of the work

1. Self-host upstream JetBrains Mono, replace the four latin subsets. Independently valuable — it fixes cross-browser fidelity and the SVG export today, with no server involved.
2. Make `computeLayout` pure (`wcwidth` widths, constant metrics). The one risky step: measured widths shift slightly, so every existing link and saved workspace re-lays-out. They still decode; they just get correct widths.
3. Add the `/s/<payload>` path form, keeping `#s=` reading.
4. Add the two routes and the resvg rasterizer, with the cache headers above.

Steps 1 and 2 are the real work and stand on their own merits. Steps 3 and 4 are small once they are done.
