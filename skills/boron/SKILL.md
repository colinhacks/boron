---
name: boron
description: Create terminal screenshots with boron.sh, a window with a title bar on a gradient backdrop, from real terminal output (ANSI colors kept) or from code. Use when the user asks for a terminal screenshot, an image of command output, a picture of a CLI run, or a pretty code or terminal image to share. Saves PNG, SVG, JPEG or WebP locally and returns a link that reopens the picture in the editor.
---

# Boron terminal screenshots

[boron.sh](https://boron.sh) draws terminal output as a window on a gradient backdrop. A link carries the whole picture, so this skill writes the link and then saves the image the app's own Save button makes.

Both scripts are in `scripts/` beside this file and need no npm install:

| Script | Needs | Does |
| --- | --- | --- |
| `link.mjs` | Node 18+ | Reads ANSI on stdin and prints a boron.sh link |
| `save.mjs` | Node 22+ and Chrome, Chromium, Edge or Brave | Opens the link headless and writes the image |

## 1. Capture the output

Keep the escape codes, and write to a temporary directory rather than the user's working tree. Most tools turn color off when stdout is not a terminal, so force it:

```bash
TMP=$(mktemp -d)
FORCE_COLOR=1 CLICOLOR_FORCE=1 pnpm test > "$TMP/out.ansi" 2>&1
git -c color.ui=always --no-pager log --graph --oneline -10 > "$TMP/out.ansi"
```

A tool that still prints no color needs a pseudo-terminal. Use `script -q /dev/null <cmd> > "$TMP/out.ansi"` on macOS and `script -qec "<cmd>" /dev/null > "$TMP/out.ansi"` on Linux.

- **Code:** save it as is and pass `--language` in step 3, which colors it with the app's highlighter.
- **Output to mock up:** write the escapes yourself, as in `printf '\e[32m✓\e[0m passed\n'`. The sixteen named colors, 256-color, truecolor, bold, dim, italic, underline, inverse and strikethrough all render.
- **Prompt lines:** a line starting with `$ `, `❯ `, `> ` or `➜ ` is drawn bold as a command, and plain lines after it are dimmed.

## 2. Make the link

```bash
LINK=$(node scripts/link.mjs --title "pnpm test" < "$TMP/out.ansi")
```

Use the defaults unless the user asked for something else, and tell them afterwards which values you used.

| Flag | Values | Default |
| --- | --- | --- |
| `--theme` | `boron`, `vscode`, `dracula`, `tokyo-night`, `catppuccin-mocha`, `nord`, `one-dark`, `solarized-dark` | `boron` |
| `--backdrop` | `midnight`, `ember`, `mint`, `dusk`, `sand`, `arctic`, `graphite`, `ink`, `none` (transparent), or `#rrggbb` | `midnight` |
| `--title-bar` | `on`, `off` | `on` |
| `--title` | text, up to 200 characters | empty |
| `--columns` | `auto`, or a width of 1–400 columns that longer lines wrap to | `auto`: the widest line, from 80 to 400 |
| `--aspect` | `og` (1200×630), `square` (1080×1080), `wide` (1920×1080) | sized to the content |
| `--padding` | px around the window, 0–400 | `48` |
| `--radius` | corner radius in px, 0–200 | `12` |
| `--shadow` | 0–100 | `100` |

An unknown theme or backdrop falls back to the default and out-of-range numbers are clamped, so check the spelling.

## 3. Save the image

The file extension picks the format: `.png`, `.svg`, `.jpg` or `.webp`. Raster images are 2x.

```bash
node scripts/save.mjs "$LINK" ./pnpm-test.png
node scripts/save.mjs "$LINK" ./greet.svg --language typescript
```

It prints the saved path, then a link to the picture as exported. Report that second link, since only it carries the colors `--language` added. The languages are `typescript`, `javascript`, `python`, `rust`, `go`, `json`, `bash`, `yaml` and `sql`. Leave it off for output that already has colors, which it would replace.

Set `CHROME_PATH` if it finds no browser. To use Playwright or Puppeteer instead, run the export from a script that writes the file:

```js
await page.goto(link);
await page.waitForFunction(() => window.boron);
const { data, link } = await page.evaluate(() => window.boron.export({ format: "png" }));
fs.writeFileSync("out.png", Buffer.from(data, "base64"));
```

Never return `data` through a browser tool that hands its result back to you, because a PNG is hundreds of kilobytes of base64. With no browser at all, give the user the link and tell them to click **Save**.

## 4. Report

Tell the user the saved path, the link (it reopens the picture in the editor to restyle or export again), and the settings you used. Then delete `$TMP`.

## Troubleshooting

- **No colors:** the command wrote no escapes. Running `cat -v "$TMP/out.ansi" | head` should show `^[[`, so force color as in step 1.
- **Uncolored code:** pass `--language` to `save.mjs`.
- **Long output:** a document holds at most 5000 lines, and a few dozen read best in an image. Cut it to the part that matters.
