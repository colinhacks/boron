# Working in this repo

**Read [wiki/architecture.md](wiki/architecture.md) first.** It is the map of the system — the four layers and which way they depend, how a paste becomes pixels, the invariants that are load-bearing (above all: everything Boron draws has to be expressible as an ANSI escape sequence), the three renderers that have to agree, and a "where do I change X?" table. This file covers *process*; that one covers *the code*. Share links **are** shipped — "Copy link" in the export button, written by [src/share.ts](src/share.ts) over the frozen wire format in [src/wire.ts](src/wire.ts). [wiki/share-links.md](wiki/share-links.md) explains why the *first* attempt was pulled and what the seam had to be before a second one could stand, and [wiki/og-images.md](wiki/og-images.md) sketches the server-side card that depended on them. [wiki/fonts.md](wiki/fonts.md) covers the bundled typeface — Nerd-Font-patched JetBrains Mono, split into a text family that always loads and an icon family that only loads when a document contains one — and the measurements that split rests on.

## Git

**Commit straight to `main`.** No branches, no pull requests, no staging your work for review. When something is done, commit it and push it — a push deploys to [boron.sh](https://boron.sh) via Vercel, and that is fine.

**Don't spend effort on git hygiene.** Atomic commits, tidy history, branch strategy — none of it matters here. Do not stop to ask whether a commit is scoped cleanly, and do not leave finished work uncommitted because the diff also touches something else.

**Several agents may be working at once**, so the tree you are in probably contains edits that are not yours. That is normal and expected:

- Leave other agents' changes alone. Don't revert them, don't "fix" them, and don't wait for them to finish.
- `git add` the paths you actually worked on and commit. If someone else's in-flight change rides along, that is acceptable — it is not worth a round trip to avoid.
- Your own files may get swept into someone else's commit before you get to them. Check `git log -- <path>` before assuming work was lost.
- The one thing that does bite: never rewrite shared history. No `rebase`, `reset --hard`, or force-push on `main` — other agents are working from it, and rewriting it destroys their work rather than just untidying yours.

## Toolchain

The package manager is **`nub`**, not npm or pnpm.

| Command | What it does |
| --- | --- |
| `nub run dev` | Vite dev server |
| `nub run build` | `tsc --noEmit`, then a production build to `dist/` |
| `nub run test` | Vitest |
| `nub run typecheck` | `tsc --noEmit` alone |

`nub run build` is the gate — it typechecks before bundling, so a green build covers both.

This is a **Vite + React** app, not Next.js. There is a root `index.html` carrying all the page metadata, the entry is `src/main.tsx`, and static files are served from `public/` verbatim.

## Copy

Emojis are fine here — in the README, on the site, and in commit messages. The general prose guide bans them; this project overrides that.

## Persisted state

The whole workspace — document, theme, backdrop and frame settings — is saved to `localStorage`. A changed default therefore reaches nobody who has already opened the app; their stored copy wins. When you change a default that everyone should get, bump `STORAGE_KEY` in `src/App.tsx`.

## Clipboard fixtures

`src/core/clipboard-fixtures.ts` holds rich-text clipboard payloads captured **verbatim from a real copy**. Terminals disagree enough about their `text/html` flavour that invented markup only tests your imagination — Ghostty marks every styled run as a `<div style="display: inline">`, VS Code and Konsole use one block element per row, and Terminal.app states its colours only in class-based CSS in a `<style>` block, with each row's dominant colour on the `<p>` and the runs that differ overriding it.

**Capture HTML the way the app receives it — off a real paste event, not off the pasteboard.** On macOS those are not the same thing. Terminal.app and iTerm2 write no HTML flavour at all, only `public.rtf`, and inspecting the pasteboard makes them look unsupportable. They aren't: Chrome converts RTF through `NSAttributedString` on the way in, so the page is handed a full `text/html` that the pasteboard never held. That conversion lives in Chromium's `clipboard_mac.mm` and exists **only on macOS**, which is why we parse `text/rtf` ourselves too — see `rtf-paste.ts`. RTF has no such subtlety and can be read straight off the pasteboard.

**The RTF parser is ours on purpose, and it was not the first choice.** Both npm candidates were evaluated and both lose on the same point — this is a browser bundle. [`@iarna/rtf-parser`](https://www.npmjs.com/package/rtf-parser) is the general one, but it is Node streams plus `iconv-lite`, unmaintained since 2019, ships **no tests at all**, and does not implement `\uc` — so it emits the fallback characters after every `\u` as text. [`rtf-stream-parser`](https://www.npmjs.com/package/rtf-stream-parser) is maintained and dependency-free, but it exists to de-encapsulate HTML out of Outlook mail and does not surface per-run colours. Ours costs about a kilobyte; `iconv-lite` alone is a thousand times that, and the browser already ships every decoder it contains as `TextDecoder`.

What we took from prior art instead was the testing. The conformance block in `rtf-paste.test.ts` is `rtf-stream-parser`'s tokenizer suite restated against our own fixtures, and it caught four real bugs: `\bin`'s payload being scanned for control words, a truncated `\'` escape eating the character past it, `\~` dropped, and no `\plain`. Two more came from running its example documents: a font's `\fcharset` has to outrank the document's `\ansicpg` (Outlook writes cp1252 documents full of Shift-JIS), and `\ansicpg1200` still means cp1252 for byte escapes. Against those documents we now reproduce its published expected output exactly. `@iarna/rtf-parser` also makes a good differential oracle — run it over the same copy and it agrees with us character for character, same text, same style boundaries.

There are therefore two parsers, and `parseClipboard` in `paste.ts` tries HTML first: it is the flavour every terminal that writes rich text at all will offer, and on macOS the two say the same thing because the HTML is made out of the RTF. A test pins that — both parsers must produce the same document, character for character, from the same copy. RTF is what is left when nothing made that conversion for us.

**A web page is a source too, and Chrome writes it differently.** Copying out of a browser goes through Blink's own serializer, which inlines *computed* styles onto every element — so a Shiki code block arrives as a flat run of sibling `<span>`s that each restate the block's `background-color`, with no wrapper and no row to read a default off. `uniformBackground` is what keeps that backdrop off every character. Chrome also omits `display`, which is what `relineFromPlainText` is for.

Two consequences worth knowing. Rich-text copy is often **off by default**: iTerm2 needs Cmd-Opt-C rather than Cmd-C, and Windows Terminal needs `copyFormatting` set — its default is plain text only. And a terminal that hands us colours may state them per *row* rather than per *run*; `defaultColors` in `html-paste.ts` is what stops those rows from painting a colour onto every character.

If you need to support another terminal, capture its real bytes and add them there rather than writing markup you believe it emits. [wiki/clipboard-sources.md](wiki/clipboard-sources.md) maps what every terminal and editor worth naming actually writes — which of them offer a rich flavour at all, which need a setting turned on first, and which quirks have already cost something. Read it before you start; it marks which rows are captured bytes and which are only somebody's reading of the source.

## Brand assets

The brand assets in `public/` — the mark, favicons, icons, the Open Graph card — are **generated**. Don't hand-edit those files; they will be overwritten. (`example.png`, the exported sample the README and the page copy show, plus `robots.txt`, `sitemap.xml` and `site.webmanifest`, are ordinary hand-maintained files.)

```
node scripts/build-assets.mjs   # → public/*.svg
./scripts/rasterize.sh          # → public/*.png and favicon.ico
./scripts/render-og.sh          # → public/og.png
```

**The Open Graph card is the exception** and does not go through the SVG pipeline. It is set in JetBrains Mono, which lives in `node_modules` as a woff2; `rsvg-convert` resolves fonts through fontconfig, finds no system copy, and silently substitutes a generic mono. So the card is authored as HTML in `scripts/og-card.html` and rendered by headless Chrome. Edit the HTML, re-run `render-og.sh`, commit the PNG.

The cell grid, the gaps and the color ramp live as data at the top of `build-assets.mjs`, so retuning the mark is a one-line change that propagates to every asset. `src/ui/Logo.tsx` mirrors the same geometry for the in-app header and has to be updated alongside it.

Requires `rsvg-convert` (`brew install librsvg`) and ImageMagick.
