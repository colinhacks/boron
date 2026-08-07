# The bundled font

Boron ships its own typeface rather than asking for one, because the promise the app makes is that the picture you see is the picture you save and the picture the next person opens. A font resolved from the reader's system breaks all three at once. What follows is what is bundled, why it is split in two, and the measurements the split rests on — all of them taken against the actual files in [src/assets/fonts/](../src/assets/fonts), not inferred.

## What is bundled

JetBrains Mono, patched by [Nerd Fonts](https://github.com/ryanoasis/nerd-fonts) v3.5.0, subset into two families by [scripts/build-fonts.py](../scripts/build-fonts.py).

| Family | Faces | Covers | Size | Loaded |
| --- | --- | --- | --- | --- |
| `Boron Mono` | 4 (400/700 × normal/italic) | Everything outside the Private Use Area — latin, latin-ext, Cyrillic, Greek, box drawing, blocks, arrows, dingbats, braille, math | 203 KB total | Always |
| `Boron Icons` | 1, shared by every weight and style | The Private Use Area — the ~10,500 glyphs Nerd Fonts patches in | 880 KB | Only when a document contains one |

[src/export/fonts.ts](../src/export/fonts.ts) declares them from JS rather than from a stylesheet, so the display font and the font embedded into an exported SVG come from one set of files and cannot drift.

## Why it replaced the Google-Fonts subsets

Before this, Boron imported four `jetbrains-mono-latin-*.woff2` files from `@fontsource/jetbrains-mono`. Google publishes only subsets, and it strips box-drawing, arrows and dingbats out of every one of them — so `─ │ ╭ ➜ ✓ ✗ ⚠ █`, which is what terminal output is *made of*, fell through to whatever monospace font the reader's OS supplied.

That was measurable and it was a real defect, not a theoretical one. Against the old bundle, `M`, `0` and `é` came from the bundled font at exactly `9.000px` while `─ │ ╭ ➜ ✓ ✗ ⚠ █` each measured `9.031px` — byte-identical to the no-font-available case. The same document therefore rendered at different widths on macOS and on Windows, and an exported SVG carried none of those glyphs at all. Nerd Font glyphs were worse still: every one of them drew JetBrains Mono's `.notdef`, so a pasted Starship prompt came out as a row of identical slashed boxes. Rasterizing five *different* icons produced byte-identical ink — 143 pixels, same bounding box — which is how you tell one repeated tofu from five missing glyphs.

Patching fixes both at once, because the upstream font has the symbol blocks and the patch adds the icons.

## The three measurements the design rests on

**Every mapped glyph advances exactly 0.600 em.** All 12,121 of them, in every face. That is already Boron's invariant — `9.000px` at `FONT_SIZE = 15` — so nothing in [layout.ts](../src/export/layout.ts) or [wrap.ts](../src/core/wrap.ts) had to change. This is why the *Mono* variant is the one to patch from: plain `NerdFont` is nearly identical, but `NerdFontPropo` is proportional and would break the grid.

**The icon outlines are byte-identical across all four weights.** The patcher inserts the same curves into each source face. Of the 1,004 codepoints whose outlines genuinely vary by weight, not one is in the Private Use Area. So the icon face ships once and is shared, rather than four times — which is 2.6 MB not spent. It is declared across the whole weight range (`font-weight: 100 900`) so a bold run matches it exactly instead of being handed a synthetic bold.

**The split is the Private Use Area, not "U+E000 and above".** Those are not the same set, and the difference matters: the patched font maps about fifty non-icon glyphs above U+E000 — the ℂ ℍ ℕ double-struck letters, some fullwidth forms, and U+FFFD, the replacement character you get for undecodable bytes. They live in the text faces. Treating them as icons would make a single `�` in a paste — or, on a naive `>= 0xE000` test, a single emoji — pull down a megabyte.

## How the icon face stays optional

Nothing fetches it until something needs it, and "needs it" is decided in one place: `hasIconGlyphs` in [fonts.ts](../src/export/fonts.ts).

- **The editor** ([App.tsx](../src/App.tsx)) watches the document and the window title, and loads the face the moment a paste or a keystroke puts a private-use codepoint in either.
- **The exporters** ask [paint.ts](../src/export/paint.ts) instead of the document. `textOps` flattens the display list — which is the only thing that knows about the chrome title, drawn from the frame settings and never present in the document at all — and `fontUsage` reduces it to the faces actually painted with. The canvas awaits that before its first `fillText`, because a canvas draws whatever is loaded at the moment it is asked and never repaints when a font lands late.

The same reduction decides what an SVG carries, and the font dominates that file: an export of a small block is 140 KB, of which 3 KB is the picture. Only the faces a document actually paints with are inlined, so a document with no italic in it carries two faces rather than four.

| Export | SVG size |
| --- | --- |
| With the old latin-only bundle | 119 KB |
| Now, no icons in the document | 140 KB |
| Now, with icons | 1.24 MB |

The middle row is the honest cost of the fidelity: the text faces are bigger because they now contain the symbols that used to fall back, partly offset by inlining only what is used. The bottom row is the one worth improving, and the way to improve it is subsetting per document at export time — the demo block above needs 110 codepoints, which is 85 KB of base64 rather than 1.24 MB. That needs a wasm subsetter in the bundle and has not been done.

## Regenerating

```
pip install 'fonttools[woff]' brotli
python3 scripts/build-fonts.py
```

It downloads the pinned Nerd Fonts release, subsets it and writes the five `.woff2` files plus the upstream licence. One trap is baked into the script with a comment on it: fontTools can emit woff2 straight out of the subsetter, but it skips the glyf transform when it does and the result is roughly twice the size — which reads as "subsetting made it bigger". Compression is a separate step for that reason.

## Licensing

JetBrains Mono is SIL OFL 1.1 ([LICENSE.txt](../src/assets/fonts/LICENSE.txt)). The patch aggregates icon sets under mixed terms, listed in [UPSTREAM.md](../src/assets/fonts/UPSTREAM.md) — Font Awesome and Codicons are CC BY 4.0 and want attribution, Pomicons is OFL with a Reserved Font Name, and the release lists Font Logos as unlicensed. Shipping a subset rather than all 12,000 glyphs is the narrower exposure, and the two files travel with the fonts.
