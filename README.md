<div align="center">
  <img src="public/mark.svg" alt="" width="76" height="76">
  <h1>Boron</h1>
  <p><a href="https://boron.sh">boron.sh</a></p>
</div>

A carbon.now.sh for **terminal** blocks. Compose a terminal session, keep its colors, export it as an image.

Everything Boron can draw is representable in a real terminal. That is the constraint the whole design hangs off: the palette is chalk's sixteen named colors, the modifiers are chalk's modifiers, and even the automatic styling is expressed as chalk marks rather than as hand-picked hex — so the picture you compose and the escape sequence you copy out are the same thing.

## Run it

```
nub install
nub run dev
```

| Script | What it does |
| --- | --- |
| `nub run dev` | Vite dev server |
| `nub run build` | typecheck, then production build to `dist/` |
| `nub run test` | Vitest suite |
| `nub run typecheck` | `tsc --noEmit` |

## What it does

**`$` means command.** A line starting with `$` or `❯` — optionally after a prompt lead-in like `colin@mac:~/code$` — renders bright, and everything else dims as output. A trailing `\` continues the command onto the next line. A document with no commands at all stays at normal weight rather than dimming wholesale, so plain notes don't look washed out.

The heuristic is deliberately narrow. `$HOME`, `$(date)` and `cost is 5$ each` are not prompts, and `>`, `#` and `%` are not markers — they collide with diffs, comments and percentages far more often in real output than in real prompts.

oh-my-zsh's `➜` counts too, but only at column 0. The same character is what vite, pnpm and friends bullet their *output* with, and the two are told apart by position: a prompt owns the start of its line, while a decorative arrow is indented under the thing it belongs to. `➜` also leads its prompt rather than closing it — the directory and git status come after — so only the arrow itself is treated as chrome.

**Paste keeps its colors.** Paste terminal output and Boron reads whatever styling came with it:

- **ANSI escapes** in `text/plain` — the full SGR set, including 256-color and truecolor in both the `;` and `:` forms, plus `\r`, `\b` and erase-line, so a pasted progress bar collapses to its final frame instead of smearing.
- **Rich text** in `text/html`. Colors are mapped back onto *named* palette entries where they match a known terminal palette, so a pasted green stays `green` and re-themes with the rest of the block instead of freezing as one terminal's hex.

  Fewer terminals write this flavor than you would guess, and the ones that do disagree about how. Ghostty writes it by default since 1.3.0 and marks every styled run as a `<div style="display: inline">`, with rows separated by literal newlines under `white-space: pre`. Konsole writes it by default too, but as an XHTML document with a `<br>` after every row. VTE (GNOME Terminal, Tilix) and VS Code's terminal can, behind an explicit "Copy as HTML" action, and Windows Terminal behind `copyFormatting` — those two put one block element per *row*. Reading a `display` declaration rather than trusting the tag is what keeps Ghostty's per-run `<div>`s from becoming one line each.

  iTerm2, macOS Terminal.app, kitty, WezTerm and Alacritty never write HTML at all — a copy from those is plain text, and lands on the ANSI or `$` path below. `src/core/clipboard-fixtures.ts` holds payloads captured off a real pasteboard, which is the only honest way to test this.

ANSI wins over rich text when both are present, because SGR codes name their colors while HTML has already resolved them.

The wrapper color a terminal puts on its clipboard is treated as *unstyled*, not as an explicit mark. That is what lets a paste from VS Code still dim its output and brighten its commands, instead of arriving with a color frozen onto every character.

Only when a paste carries no styling at all does it fall through to plain text and the `$` heuristic.

**Select and recolor.** Highlight any run and apply a chalk color, fill or modifier. The toolbar's contents are decided by exactly one rule: a control exists if and only if it is exactly one SGR code. Sixteen foregrounds (SGR 30-37, 90-97), sixteen fills (40-47, 100-107), and bold, dim, italic, underline, strike, inverse and hidden (SGR 1, 2, 3, 4, 9, 7, 8). Each tooltip names the chalk method and the code. `⌘B`, `⌘I`, `⌘U` and `⌘\` (clear) work as you'd expect.

**Export.** PNG, SVG, JPEG and WebP at 1×–3×, plus copy-to-clipboard. Or copy the block back out as raw ANSI, as a runnable `chalk` snippet, or as plain text — which is the point of the tool: mock up what you want a program to print, then hand an agent the escape sequence to reproduce.

## How it holds together

```
src/core/     pure and testable — palette, themes, ANSI parse/serialize, HTML paste, prompt heuristic
src/editor/   Slate: the paste override, the role decorator, marks, leaves
src/export/   layout, canvas/PNG, SVG, font embedding
src/ui/       toolbar, sidebar, sample document
```

Two decisions carry most of the weight.

**The automatic styling is marks, not colors.** `core/style.ts` merges the marks a run's role *implies* (a command is `bold`, output is `dim`) with the marks it explicitly carries. Explicit always wins, and a run with its own color keeps full intensity so pasted color stays vivid while plain output recedes. The editor's leaves, the canvas renderer, the SVG renderer and the ANSI serializer all go through that one function, so they cannot disagree. `serialize.test.ts` pins this down: render → ANSI → parse → render is compared character by character across six documents and two palettes.

**A theme is a palette, not a style.** It decides what `red` looks like, exactly as a terminal profile does, and has no say in which marks a run carries — so `toAnsi` takes no theme at all and one document has one correct serialization. That is also why a command is `bold` rather than bright white: bold is legible against any palette, while bright white *is* the background on a light profile.

**Export lays itself out.** A terminal is a fixed-advance grid, so `export/layout.ts` measures runs once and both renderers consume the result — the canvas draws it and the SVG positions every run at the same measured `x`, with the font embedded. No DOM screenshotting, so there is no `foreignObject` fidelity or font-embedding lottery, and the editor is sized from the same layout it exports.

## Stack

[nub](https://nubjs.com) 0.6 (package manager, script runner, `nub.lock`) · Vite 8 · React 19 · [Slate](https://docs.slatejs.org) 0.126 · Vitest 4 · JetBrains Mono.
