# What each app puts on the clipboard

Boron's paste path prefers `text/plain` carrying SGR codes, then `text/html`, then `text/rtf`, then plain text — see [architecture.md](architecture.md) for why that order. This page is the map of what is actually on the other end of it: which apps write a rich flavour at all, whether they do it without being asked, and the shape they use.

**Read this before adding support for a source.** It is what stops you writing markup you believe a terminal emits. The rule in [AGENTS.md](../AGENTS.md) stands: a fixture is bytes captured from a real copy, and if you have not captured them, you do not have them.

## Where the confidence comes from

Three tiers, and the table marks which each row is.

- **Fixture** — real bytes, in [src/core/clipboard-fixtures.ts](../src/core/clipboard-fixtures.ts), pinned by a test. Ghostty, Terminal.app (HTML and RTF), the VS Code editor, the VS Code terminal's serializer, and two docs-site code blocks.
- **Read** — no capture, but the app's own clipboard code was read. Good enough to know the shape and to say whether a flavour exists; not good enough to write a fixture from.
- **Unknown** — say so and stop. Warp is closed source and documents nothing about clipboard formats; JetBrains' reworked terminal might route through IntelliJ's rich copy and the wiring was not found.

The **Read** rows were gathered on 2026-08-13 against each project's source at the time. These formats change; re-read before trusting one.

## The table

| App | Rich flavour | On by default? | Shape | Confidence |
| --- | --- | --- | --- | --- |
| Ghostty | `text/html` | **Yes** | One wrapper, every run a `<div style="display: inline">`, rows as literal `\n` | Fixture |
| macOS Terminal.app | `public.rtf` | **Yes** (plain is the opt-out) | AppKit's RTF writer; on macOS Chrome converts it to HTML on the way in, with the colours in a `<style>` block | Fixture |
| VS Code / Cursor editor | `text/html` | **Yes**, on ordinary Cmd-C | Wrapper carrying the theme's fg/bg, one `<div>` per line, one `<span>` per token | Fixture |
| VS Code / Cursor terminal | `text/html` | No — "Copy Selection as HTML"; Cmd-C is plain | xterm.js serializer: one `<div>` per row, every row padded to the column count | Fixture |
| iTerm2 | `public.rtf` **only** | No — Cmd-Opt-C, or `copyWithStylesByDefault` | The same AppKit writer as Terminal.app | Read |
| Konsole | `text/html` | **Yes** (`CopyTextAsHTML`) | `<span style>` per run, `<br>` per row, `&#160;` inside space runs | Read |
| Tabby | `text/html` | **Yes** (`copyAsHTML`) | xterm.js serializer, as above | Read |
| GNOME Terminal, Ptyxis (VTE) | `text/html` | No — a separate "Copy as HTML" item | One `<pre>`; **the foreground is a `<font color>` attribute**, not a style | Read |
| Windows Terminal | `CF_HTML` / `CF_RTF` | No — `copyFormatting`, default off | UPPERCASE `<SPAN STYLE>` runs and `<BR>` rows, no newlines at all | Read |
| ConEmu | `CF_HTML` | No — `CTS.HtmlFormat` | `<span style>` runs, `<br>` rows, spaces as `&nbsp;` | Read |
| PuTTY | `CF_RTF` | No | Background is `\highlightN` rather than `\cbN`; bytes in the machine's ANSI code page with no `\ansicpg` | Read |
| kitty | none | — | Plain text. But `copy_ansi_to_clipboard` puts **SGR escapes in `text/plain`**, which Boron's `hasAnsi` path reads | Read |
| Alacritty, WezTerm, Rio, xterm, Hyper, Zed, JetBrains (JediTerm), tmux, GNU screen | none | — | Plain text only. Nothing to recover; the `$`-prompt heuristic is what they get | Read |
| Warp | unknown | unknown | Closed source, undocumented | Unknown |
| JetBrains' reworked terminal | unknown | unknown | The classic JediTerm path is plain text; the new one may differ | Unknown |

## The quirks that cost something to handle

Each of these is a real defect that was found and fixed, or a trap that is currently defended against. They are listed because the *next* source will have quirks too, and these are the shapes they take.

- **A styled run marked up as a block.** Ghostty writes every run as a `<div>` and puts `display: inline` on it, so going by the tag alone breaks a line at every colour change. A `display` declaration outranks the tag — that is what `INLINE_DISPLAYS` is for.
- **Colour stated per row rather than per run.** Terminal.app hangs each row's dominant colour on the `<p>` and overrides it per span. `defaultColors` is what stops those rows painting a colour onto every character.
- **A backdrop with nothing to read it off.** Chrome serializes *computed* styles, so a code block copied out of a browser is a flat run of sibling spans that each restate the page's background — no wrapper, no row. `uniformBackground` treats a colour covering every character as a surface. A colour covering only part of the text is a badge and stays.
- **Rows padded to the window.** xterm.js pads every row out to the column count. `trimTrailingPadding` drops that, by the same rule `parseAnsi` uses: a trailing space wearing a background or an underline is the terminal drawing, not padding.
- **Rows that only the plain flavour knows about.** Chrome omits `display`, so a docs site whose rows are `<span>`s made block by a stylesheet arrives with no row boundary anywhere. `relineFromPlainText` cuts on the plain flavour's newlines when the two agree character for character.
- **Misnested markup.** Ghostty opens an `<a>` in one `<div>` and closes it in the next; it is in upstream's own test expectations, so it is the format rather than a passing bug. The HTML parser's own recovery handles it — but it means the DOM you walk is not the tree the markup looks like.
- **A wrapper that lies.** The xterm.js serializer hard-codes `#000000` on `#ffffff` for its wrapper whatever the real theme is, because VS Code never passes `includeGlobalBackground`. Discounting the wrapper is right anyway; believing it about anything else is not.
- **NBSP as padding, and uppercase tags.** Konsole and ConEmu put `&#160;` inside runs of spaces; Windows Terminal writes its tags in capitals. Both are handled, and both are pinned by a test.

## Two things worth telling a user

Rich copy is **off by default** in more terminals than not — iTerm2 needs Cmd-Opt-C, Windows Terminal needs `copyFormatting`, VTE and the VS Code terminal need a separate menu command. When someone reports "my colours did not come through", that is the first thing to check.

And for the plain-text-only terminals there is a better answer than the `$`-prompt heuristic: pipe the command through something that keeps its escapes, or use kitty's `copy_ansi_to_clipboard`. Boron reads SGR codes out of `text/plain` in preference to any rich flavour, because escape codes *name* their colours while HTML has already resolved them to one terminal's hex.
