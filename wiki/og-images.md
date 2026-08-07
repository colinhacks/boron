# Rendering a share link's image on the server

A design sketch, not a built feature. The goal: paste a Boron link into Slack, Twitter, Discord or iMessage and have the unfurl show *that terminal block*, rendered server-side, rather than the one static card everybody gets today.

Two things have to be true for it to work. The first now is; the second is not, and turned out to be a defect in what share links already promise. Both are written up here with what was actually measured.

## Blocker 1 — solved: the payload is in the query string

Share links used to be `boron.sh/#s=<payload>`. A URL fragment is stripped by the browser before the request goes out: it never reaches Vercel, never appears in a log, and is never sent to a crawler. Good for privacy, and fatal for a preview card — Slack, Twitter and the rest fetch the URL and read `<meta>` out of the HTML, without running JavaScript, so a card can only be built from something the server is actually told.

So `buildShareUrl` now emits `boron.sh/?s=<payload>`, falling back to the fragment past `MAX_QUERY_URL_LENGTH` (a fragment has no practical length cap; a query string rides in the request line, which proxies cap at roughly 8-16KB). Those long links simply do not get a card. `shareParamFrom` reads both forever.

An earlier draft of this proposed a `/s/<payload>` path form instead. The query string does the same job with no routing to add, so the path form is not worth it.

What remains is one route and one piece of middleware:

| Route | Returns |
| --- | --- |
| `/` with `?s=` present | The app shell, with `og:image` pointed at the image route and an `og:title`/`og:description` derived from the payload. Middleware, short-circuiting immediately when there is no `s`, so the bare homepage stays static |
| `GET /og/<payload>.png` | The rendered PNG |

## Blocker 2 — layout needs a browser

`computeLayout` in [src/export/layout.ts](../src/export/layout.ts) measures every span with `CanvasRenderingContext2D.measureText`, and derives half-leading from `fontBoundingBoxAscent`/`Descent`. There is no canvas on a serverless runtime.

Measuring what the browser actually does turns this from a problem into an opportunity. At `FONT_SIZE = 15`:

- Every glyph **that comes from the bundled font** advances exactly `9px` — `0.6 × fontSize`, identical across all four faces (regular, bold, italic, bold-italic).
- Measurement is exactly additive: `measureText("$ npm run build --workspace=@acme/app")` minus `length × 9` is **0.000px**.

So for text the app ships a font for, layout needs no rasterizer at all — it is `length × 0.6 × fontSize`.

**The half of this that used to be a blocker is now fixed.** The bundle was four Google-Fonts latin subsets, which have box-drawing, arrows and dingbats stripped out of them, so terminal output fell through to the reader's system font at `9.031px` against the bundled `9.000px` — the same document rendering at different widths on different machines, and an exported SVG carrying none of those glyphs. Boron now bundles JetBrains Mono patched by Nerd Fonts, split into a text family and an on-demand icon family; every one of its 12,121 mapped glyphs advances exactly `0.600 em`. See [fonts.md](fonts.md). What is left of this blocker is only the rasterizer.

So the remaining work is to replace the canvas measurement with a pure function:

- `charWidth = FONT_SIZE * 0.6`, exactly.
- Width is a per-codepoint sum, `1` for ordinary cells and `2` for the wide ranges (CJK, emoji) — which is `wcwidth`, the same rule a real terminal uses to decide how many cells a glyph occupies. Arguably more correct than asking Canvas2D.
- Ascent and descent become constants read once from the font's own metrics rather than from `measureText`.

Two things still fall outside the bundled font and so still need `wcwidth` rather than a `× 0.6`: emoji (`🚀` measures `19px`) and CJK (`中`, `15.3px`). Both are genuinely two cells wide, which is what `wcwidth` says. (A warning that survives from the original measurement: `document.fonts.check()` returned `true` for every one of the glyphs that was in fact falling back. It reports whether *some* font in the stack can render, not whether the first one has the glyph. Measure, don't ask.)

Layout then runs anywhere, is identical on client and server, and — the part that matters most — is finally identical *across browsers*, which is what the share link claimed all along.

## What ports, exactly

There are two renderers today, and they port very differently. Grepping the whole of `src/export/` for `document.`, `window.`, `getContext`, `createElement`, `FontFace`, `Blob`, `fetch(`, `btoa` and `URL.createObjectURL`:

| Module | Browser APIs it touches | Ports? |
| --- | --- | --- |
| [scene.ts](../src/export/scene.ts) | none | as-is |
| [background.ts](../src/export/background.ts) | none | as-is |
| [svg.ts](../src/export/svg.ts) | none | as-is |
| [layout.ts](../src/export/layout.ts) | `document.createElement("canvas")`, `getContext` — two lines, both in `context()` | no, and this is the blocker |
| [canvas.ts](../src/export/canvas.ts) | the whole thing: `createElement`, `getContext`, `roundRect`, `createLinearGradient`, `shadowBlur`, `fillText`, `toBlob` | no |
| [fonts.ts](../src/export/fonts.ts) | `FontFace`, `document.fonts.add`, `fetch`, `btoa` | partly — `embeddedFontCss` needs the bytes from disk instead of `fetch`; `ensureFontsLoaded` is display-only |

So the answer is not the one you would guess. **The SVG renderer is already pure** — `svg.ts` builds a string and touches nothing browser-specific, and `scene.ts` and `background.ts` (including the CSS gradient geometry) are pure too. The PNG renderer does not port at all, and does not need to: rasterizing our own SVG reuses the renderer rather than replacing it.

**What actually blocks both is `computeLayout`** — two lines in `layout.ts` that make a canvas to call `measureText` on. `renderToSvg` positions every run at a measured `x` rather than letting text flow (that is what keeps SVG and PNG pixel-aligned), so it inherits the dependency wholesale. Make measurement pure and the SVG path runs on a server unchanged.

One honest caveat: a server-rasterized PNG will match the geometry of a browser Save-PNG exactly, since both come from the same `Layout` numbers, but not the antialiasing — resvg and Chrome hint and blend text differently. Fine for an unfurl; not the same claim as the client-to-client pixel-identity share links make.

## Rendering, once layout is pure

With a pure layout the whole pipeline runs on a server: decode the payload → sanitize → `documentToRenderLines` → `computeLayout` → `renderToSvg`.

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

1. ~~Move the payload to the query string.~~ Done.
2. ~~Self-host the font, replace the four latin subsets.~~ Done — as Nerd-Font-patched JetBrains Mono rather than the plain upstream release, which closes the icon gap at the same time. See [fonts.md](fonts.md).
3. Make `computeLayout` pure (`wcwidth` widths, constant metrics). The one risky step: measured widths shift slightly, so every existing link and saved workspace re-lays-out. They still decode; they just get correct widths.
4. Add the middleware, the image route and the resvg rasterizer, with the cache headers above.

Step 3 is the real work left and stands on its own merits. Step 4 is small once it is done — and note that resvg will need the font bytes handed to it, which now means the icon face too whenever the payload contains one.
