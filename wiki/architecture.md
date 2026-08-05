# How Boron is put together

Boron turns terminal output into an editable picture of a terminal. Everything below describes the *system* — the pieces, how a paste becomes pixels, and the invariants that keep the preview, the exports and the copy-back-out text telling the same story. Process — git, `nub`, the brand-asset pipeline, clipboard fixtures — lives in [AGENTS.md](../AGENTS.md) and is not repeated here.

## The shape of the app

A Vite + React single-page app with no router and no framework around it. [index.html](../index.html) at the repo root carries every piece of page metadata (title, description, canonical, Open Graph, icons) and one `<div id="root">`; the viewport is pinned at `width=900` because there is no mobile layout. [src/main.tsx](../src/main.tsx) is the entry: it resolves a share link off the URL, *then* calls `createRoot().render()`. [src/App.tsx](../src/App.tsx) is the only stateful component — there is no store, no context beyond one small leaf-settings context, and no data fetching.

Text editing is [Slate](https://docs.slatejs.org) (`slate`, `slate-react`, `slate-history`). The document is a flat list of line elements; there are no nested blocks, no inlines and no voids.

Source is four layers, and the dependency arrows only point one way:

| Layer | What lives there | Depends on |
| --- | --- | --- |
| [src/core/](../src/core) | The pure model: ANSI parsing, the document shape, the palette, themes, the prompt heuristic, mark resolution, serialization back out to ANSI/chalk/text | nothing outside itself |
| [src/export/](../src/export) | Layout measurement, the canvas and SVG renderers, backdrops, the bundled font | `core` |
| [src/editor/](../src/editor) | The Slate integration: paste handling, normalization, decorations, the leaf renderer | `core`, plus `export/fonts.ts` for the family string |
| [src/ui/](../src/ui) | Chrome: sidebar, toolbars, split buttons, logo, the sample document | `core`, `export`, `editor` |

Nothing in `core/` imports React, the DOM, or anything from the other three layers, which is what makes it testable in isolation and what makes the exporters and the editor unable to drift on the *meaning* of a run.

## From a paste to a picture

1. **Input.** A paste lands in `editor.insertData`, overridden in [src/editor/withTerminal.ts](../src/editor/withTerminal.ts). Priority is deliberate: Boron's own Slate fragment first, then `text/plain` that contains SGR codes (`hasAnsi`), then `text/html`, then plain text. ANSI beats rich text because SGR names its colors (`green`) while HTML has already resolved them to one terminal's hex. The fragment is decoded and sanitized here rather than handed to slate-react's `insertData`, which base64-decodes the payload and calls `insertFragment` on the JSON with no validation at all — and `data-slate-fragment` is an attribute any page can put on the clipboard.
2. **Parsing.** [src/core/ansi.ts](../src/core/ansi.ts) `parseAnsi` lays characters into a per-line cell buffer with a cursor rather than appending — so `\r`, `\b`, `\t` (eight-column stops) and erase-line (`CSI K`) behave as they do in a terminal, and a pasted progress bar collapses to its final frame. OSC/DCS envelopes are dropped, C0 controls discarded, surrogate pairs kept in one cell, trailing *plain* spaces trimmed while colored ones survive. Rich text goes through [src/core/html-paste.ts](../src/core/html-paste.ts) instead, which walks the DOM, works out which elements are rows (a `display` declaration outranks the tag), treats the wrapper's own foreground as "unstyled", and maps colors back onto palette names via `nearestPaletteColor`. It returns `null` when the markup carries no styling at all, which is the signal to fall back to plain text.
3. **The document.** `parsedLinesToDocument` in [src/core/document.ts](../src/core/document.ts) produces a `TerminalDocument` — `LineElement[]`, each with `StyledText[]` children. A `StyledText` is `Marks & { text: string }`, so styling lives directly on the Slate leaf. `Marks` ([src/core/types.ts](../src/core/types.ts)) is all-optional and absent-when-off.
4. **Roles.** `documentToRenderLines` flattens the document into `RenderLine[]` of `RenderSpan { text, marks, role }`. It calls `classifyDocument` from [src/core/prompt.ts](../src/core/prompt.ts) over the whole document at once — two things need cross-line context: a trailing `\` continues a command onto the next line, and a document with *no* commands must not have every line dimmed as output. Spans are split at `commandStart`, so one leaf reading `$ npm install` yields a dim `$ ` and a bold `npm install`.
5. **Layout.** `computeLayout` in [src/export/layout.ts](../src/export/layout.ts) measures every span with a shared 2D canvas context and returns a `Layout`: per-line `top`/`baseline`, per-span `x`/`width`/resolved style, plus `charWidth`, `halfLeading`, `chromeHeight`, the terminal `Rect`, and the overall `width`/`height`.
6. **Drawing.** `Scene = { layout, frame, theme, background }` ([src/export/scene.ts](../src/export/scene.ts)). Three things draw it: the DOM preview in [src/App.tsx](../src/App.tsx), `renderToCanvas` in [src/export/canvas.ts](../src/export/canvas.ts), and `renderToSvg` in [src/export/svg.ts](../src/export/svg.ts).
7. **Text out.** [src/core/serialize.ts](../src/core/serialize.ts) takes the same `RenderLine[]` and produces raw ANSI (`toAnsi`), a runnable chalk snippet (`toChalkSource`) or plain text (`toPlainText`).

The editor is the one place that does *not* consume `documentToRenderLines` for its text: [src/editor/decorate.ts](../src/editor/decorate.ts) computes the same roles as Slate decorations, per text node, so they recompute live as you type and never overwrite a stored mark. It shares `classifyDocument`/`hasCommands` with `document.ts` but implements the span split a second time against Slate paths — the two are parallel and have to stay in agreement. `computeLayout` still runs over `documentToRenderLines`, so the block's *size* comes from the flattened path even while its glyphs come from Slate.

## Invariants

These are the load-bearing ones. Each is cheap to violate by accident and expensive to notice afterwards.

**Everything Boron draws has to be expressible as an escape sequence.** This is the invariant the whole tool rests on — the picture you compose and the escape sequence you copy out are the same thing — and it is enforced structurally rather than by care. `Marks` holds exactly the seven modifiers that are one SGR code each (`MODIFIER_KEYS` says so in as many words) plus `fg`/`bg`, and `Color` is the union `NamedColor | \`ansi256:${number}\` | \`#${string}\`` — the three ways a terminal can be told about a color, and there is no fourth case because there is no fourth escape sequence. A `rebeccapurple` or an `oklch(…)` would satisfy the browser, paint in the editor, and then serialize to nothing at all: a pixel with no escape code behind it. The type holds the line wherever the compiler can see; `isColor` in [src/core/types.ts](../src/core/types.ts) holds it at the doors where it cannot — a share link, a stored workspace — and `nearestPaletteColor` returns `null` rather than passing an unreadable color through. `serialize.test.ts` pins both directions: nothing unrepresentable gets in, and everything the model admits comes back out as a real escape sequence.

**Colors are stored as names, not as resolved hex.** Within those three forms the order of preference is names first; `colorFromAnsi256` deliberately returns the *named* form for indices 0–15. Resolution to a concrete CSS color happens only at render time, in `colorToCss`. Break this and two things fail at once: switching theme stops re-mapping the document (a pasted green freezes as one terminal's particular green), and `toAnsi` can no longer round-trip a run back to the SGR code it came from — it would have to emit truecolor for something that arrived as `32`.

**A theme is a palette and nothing more.** `Theme` ([src/core/themes.ts](../src/core/themes.ts)) is a background, a foreground, sixteen ANSI colors and an editor selection tint. It has no say in which *marks* a run carries. If a theme could decide marks, one document would serialize to two different escape sequences depending on what the sender happened to have selected, and "Copy as ANSI" would have no single correct answer. [src/core/serialize.test.ts](../src/core/serialize.test.ts) pins this under `theme independence`, including a control assertion that themes *do* still change appearance.

**The automatic styling is expressed as real chalk marks.** `roleMarks` in [src/core/style.ts](../src/core/style.ts) returns `{ bold: true }` for a command and `{ dim: true }` for a prompt or output — SGR 1 and SGR 2, not hand-picked colors. Bold rather than bright white because bright white *is* the background on a light profile. `effectiveMarks` merges the implied marks under the explicit ones, with one exception: a run that carries its own `fg` drops the implied `dim`, because the auto-dim is a fallback for *uncolored* output rather than a filter over everything — that is what lets pasted ANSI stay vivid while plain output recedes. The payoff is that every pixel on screen has an escape code behind it, so ANSI export is a straight translation with no special cases. The round-trip test in `serialize.test.ts` compares per-character appearance before and after `toAnsi` → `parseAnsi` → resolve, on two different themes.

**`resolveStyle` is the only place a run becomes pixels.** The editor's `Leaf`, `computeLayout` and therefore both exporters all call it. Anything that decides a color, a weight or an opacity anywhere else is a desynchronization waiting to happen. `dim` is one number, `DIM_BLEND = 0.45` in [src/core/palette.ts](../src/core/palette.ts), so faint means exactly one thing everywhere.

**`FONT_SIZE`, `LINE_HEIGHT_RATIO` and `TERMINAL_PADDING` are fixed, not tunable.** All three were controls once and none earned it (see the comments in `layout.ts`): raster export is scaled anyway, so font size only changed how much a line could hold. Keeping them constant is also what makes a `Workspace` a complete description of the image — see below.

**Half-leading comes from real font metrics.** `leading()` measures `fontBoundingBoxAscent`/`Descent` and derives `halfLeading = (lineHeight - (ascent + descent)) / 2`, with `baseline = halfLeading + ascent`. That is the same arithmetic a browser does for `line-height`, which is why the canvas and the SVG put a baseline exactly where the DOM preview does. `halfLeading` is reused as the vertical padding on a background-filled leaf, because a browser paints an inline background over the font's content box only while a terminal fills the whole cell. Hard-code an approximation here and the preview and the export drift apart by a pixel or two per line — invisible on line one, obvious on line twenty.

**The block does not reflow.** The editable sets `white-space: pre` explicitly, overriding Slate's `pre-wrap`, because neither a terminal nor the exported image wraps. `layout.widest` is the floor the drag-resize handles clamp to.

## The three renderers

They share `computeLayout` and the helpers in `scene.ts` — `resolveShadow`, `SHADOW`, `chromeBorderColor`, `chromeTitleColor`, `CHROME_TITLE_SCALE` — and `trafficLights` from `layout.ts`. What they do *not* share is the drawing itself:

- **The preview** ([src/App.tsx](../src/App.tsx)) positions the frame, the terminal rect, the chrome bar, the traffic lights and the shadow from `layout` numbers, then hands `fontSize`, `lineHeight`, `halfLeading`, `padding` and `width` to `TerminalSurface` and lets the browser flow the glyphs. It is the only renderer that does not place each span at a measured `x`.
- **`renderToCanvas`** draws at `EXPORT_SCALE` (2×), fills backgrounds per span, then text at `line.baseline`, then underline and strikethrough rects. For JPEG, which has no alpha, `renderBlob` passes the theme background as an `opaqueBackdrop` so a transparent frame does not encode as black.
- **`renderToSvg`** emits one `<text>` per span at the same measured `x`, with the four woff2 faces inlined as data URLs (`embeddedFontCss`) so the file renders identically anywhere.

A visual change made in one and not the others desynchronizes the preview from the export silently — nothing throws, the picture on screen just stops being the picture you save. Underline offset (`fontSize * 0.14`), strikethrough offset (`fontSize * 0.28`), thickness (`max(1, round(fontSize / 14))`), the one-pixel chrome border and the gradient geometry are all duplicated literally between `canvas.ts` and `svg.ts`; changing one means changing both.

Gradients are the subtle case. `gradientEndpoints` in [src/export/background.ts](../src/export/background.ts) reproduces the CSS gradient-line geometry (0° points up, clockwise, sized so the gradient reaches the corners) so `createLinearGradient`, `<linearGradient>` and the preview's `linear-gradient()` all land on the same ramp.

## State and persistence

One object holds everything: `Workspace` in [src/workspace.ts](../src/workspace.ts).

```ts
interface Workspace {
  document: TerminalDocument;
  themeId: string;
  backgroundId: string;
  frame: FrameSettings;
}
```

**The set of fields in `Workspace` is exactly the set that decides the rendered pixels.** Nothing outside it feeds the render: type size, line height and inner padding are constants, and the face is bundled with the app. That is what lets two browsers handed the same `Workspace` draw the same image. Adding a new visual setting means adding it here as well as to the sidebar — otherwise share links and saved workspaces silently drop it, and the picture quietly reverts to a default on the other side.

It reaches the app three ways:

- **`localStorage`**, under `STORAGE_KEY` in [src/App.tsx](../src/App.tsx) (currently `boron.workspace.v2`). Written by an effect on every change; read by `loadPersisted`, which drops malformed fields rather than defaulting them so the caller can still tell "never set" from "set to the default" and fall through to `sampleDocument()`. Because the whole workspace is stored, a changed default never reaches anyone who has opened the app before — bump the key when it should.
- **A share URL.** `encodeWorkspace` writes a `SharePayload` (`{ v: 1, doc, theme, bg, frame }`) as JSON, deflates it with `CompressionStream("deflate-raw")` when available, and base64url-encodes it behind a one-character flag: `z` for deflated, `u` for plain. Every setting is written in full and never diffed against defaults — a link is a promise about an image, and deflate makes the repetition close to free. The payload also accepts `ansi` instead of `doc`: raw terminal output, parsed on arrival exactly as a paste would be, so a link is constructible without knowing the Slate schema.

  `buildShareUrl` writes the payload into the **query string** (`?s=…`). It was the fragment first, which is better for privacy — a fragment is never sent to the server — and that is exactly what rules it out: a crawler asks the server for the page and reads its meta tags, so a preview card can only ever be built from something the server is told. Past `MAX_QUERY_URL_LENGTH` it falls back to the fragment anyway, because a fragment has no practical length limit while a query string rides in the request line that somebody else's proxy gets to cap. `shareParamFrom` reads both, and always will: fragment links are out in the world.
- **Nothing** — first visit, which lands on `sampleDocument()` from [src/ui/sample.ts](../src/ui/sample.ts). That sample is authored as real ANSI and run through `parseAnsi`, so the demo content takes the same path a paste does and is never a special case.

A share link wins outright over `localStorage` (`App` skips `loadPersisted` entirely when `shared` is set): half the sender's settings crossed with half the reader's is nobody's picture. `consumeSharedWorkspace` then `history.replaceState`s the parameter away, so editing what someone sent you and reloading keeps your edits. Because Slate captures `initialValue` on first render and decoding is async, this all has to settle in [src/main.tsx](../src/main.tsx) before `createRoot().render()`.

There is a second way in, and it is easy to forget: a link pasted into a tab **already on Boron** changes only the fragment, and a browser does not reload for that — so `main.tsx` never runs again. `App` listens for `hashchange` and applies the workspace through `applyWorkspace`, which pushes the document onto `editor.children` by hand because Slate will not take a new `initialValue`. `resetAll` goes through the same function. Anything replacing the document wholesale must also clear `editor.history`: the undo stack addresses paths in the document being replaced, so keeping it either throws on the first undo or — when the two shapes happen to line up — silently replays the old document's edits into the new one.

Everything arriving from outside goes through the sanitizers — `sanitizeFrame` (clamped wider than the sliders, because a drag can exceed them, but still clamped), `sanitizeThemeId`, `sanitizeBackgroundId` in [src/workspace.ts](../src/workspace.ts), and `sanitizeDocument` in [src/core/document.ts](../src/core/document.ts). `sanitizeBackgroundId` keeps `TRANSPARENT_ID` and turns anything else unrecognized into the default, because passing an unknown id through would quietly hand back a transparent image. `sanitizeDocument` rebuilds the document leaf by leaf rather than waving a valid-looking one through, and every leaf's marks go through `sanitizeMarks`: that rebuild is what makes the representability invariant hold against bytes somebody else wrote. It lives in `core/` because the clipboard needs it as much as the URL does.

Two ceilings guard the fact that a link is small and a document need not be. `pump` refuses past `MAX_DECOMPRESSED_BYTES`, and `sanitizeDocument` refuses past `MAX_LINES` — an 876-character link carrying `{ ansi: "hello\n".repeat(60000) }` is otherwise 240,000 DOM nodes, and because the workspace is persisted on arrival, reloading brings it straight back.

## Where do I change X?

| Change | Where |
| --- | --- |
| Add or retune a theme | [src/core/themes.ts](../src/core/themes.ts) — one `makeTheme` entry; `isLight` and `selection` are derived |
| Add a backdrop | [src/export/background.ts](../src/export/background.ts) — one `BACKGROUNDS` entry |
| Change how a paste is interpreted | [src/core/ansi.ts](../src/core/ansi.ts) for escape sequences, [src/core/html-paste.ts](../src/core/html-paste.ts) for rich text, [src/editor/withTerminal.ts](../src/editor/withTerminal.ts) for which flavor wins |
| Change the prompt heuristic | [src/core/prompt.ts](../src/core/prompt.ts) — and check [src/editor/decorate.ts](../src/editor/decorate.ts), which splits spans against Slate paths separately |
| Change what a role looks like | `roleMarks` / `effectiveMarks` in [src/core/style.ts](../src/core/style.ts) — as marks, never as colors |
| Change the frame or window | [src/export/layout.ts](../src/export/layout.ts), then all three renderers ([src/App.tsx](../src/App.tsx), [src/export/canvas.ts](../src/export/canvas.ts), [src/export/svg.ts](../src/export/svg.ts)) |
| Add a sidebar control | [src/ui/Sidebar.tsx](../src/ui/Sidebar.tsx) plus `FrameSettings` in [src/export/layout.ts](../src/export/layout.ts) — and `sanitizeFrame` in [src/workspace.ts](../src/workspace.ts), or share links drop it |
| Add a formatting control | [src/ui/Toolbar.tsx](../src/ui/Toolbar.tsx) and `MODIFIER_KEYS` in [src/core/types.ts](../src/core/types.ts). The bar for inclusion is that the control is exactly one SGR code |
| Change the copy-out formats | [src/core/serialize.ts](../src/core/serialize.ts); the menu is `COPY_MODES` in [src/App.tsx](../src/App.tsx) |
| Change the export formats or scale | [src/export/index.ts](../src/export/index.ts) |
| Change the starting document | [src/ui/sample.ts](../src/ui/sample.ts), and bump `STORAGE_KEY` so it reaches existing visitors |

## Testing

Vitest, jsdom environment, configured in [vite.config.ts](../vite.config.ts). Tests sit beside the code they cover as `src/**/*.test.ts`. `nub run test` runs them; `nub run build` typechecks and bundles.

What is covered today, all of it in `core/` plus the workspace:

- [src/core/ansi.test.ts](../src/core/ansi.test.ts) — SGR naming (standard, bright, background, 256, truecolor in both `;` and `:` forms), modifier accumulation and individual clears, resets, cursor and OSC 8 handling, and the terminal behaviours: progress-bar collapse, erase-to-end-of-line, tab stops, backspace, surrogate pairs, trailing-space trimming, a truncated escape at end of input.
- [src/core/prompt.test.ts](../src/core/prompt.test.ts) — every accepted prompt shape and, more importantly, the rejections: `$HOME`, `$(date)`, `cost is 5$ each`, an indented `➜` (which is CLI output, not a prompt), and the markers the heuristic deliberately excludes.
- [src/core/document.test.ts](../src/core/document.test.ts) — span splitting at the prompt boundary including mid-leaf, dimming only once a command exists, empty lines still occupying a row.
- [src/core/serialize.test.ts](../src/core/serialize.test.ts) — SGR emission, the ANSI appearance round-trip across six documents × two themes, theme independence, and the representability invariant: every color and every modifier the model admits produces a real escape code and survives a re-parse.
- [src/core/html-paste.test.ts](../src/core/html-paste.test.ts) — palette reverse-mapping, wrapper-color handling, `display` versus tag, and the real Ghostty payload from [src/core/clipboard-fixtures.ts](../src/core/clipboard-fixtures.ts).
- [src/workspace.test.ts](../src/workspace.test.ts) — encode/decode round-trip, that compression shortens rather than grows, the URL-safe alphabet, uncompressed payloads, `ansi`-instead-of-`doc`, per-field sanitizer fallbacks, fragment-versus-query reading, and the other half of the representability invariant: a hand-written payload carrying `rebeccapurple`, an `oklch(…)`, an out-of-range `ansi256:` or an invented mark has them stripped on the way in.

There are no component or rendering tests. `computeLayout`, the canvas and the SVG are unverified by the suite — jsdom has no real text measurement, so anything covering them would have to assert against a stub rather than against type. Check visual changes by running the app.
