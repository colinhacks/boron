---
name: boron
description: Create terminal screenshots with boron.sh, a window with a title bar on a gradient backdrop, from real terminal output (ANSI colors kept) or from code. Use when the user asks for a terminal screenshot, an image of command output, a picture of a CLI run, or a pretty code or terminal image to share. Saves PNG, SVG, JPEG or WebP locally and returns a link that reopens the picture in the editor.
---

# Boron terminal screenshots

[boron.sh](https://boron.sh) turns terminal output into an image. A link can carry the whole picture: the content as ANSI, plus the theme, backdrop and frame. This skill makes that link, opens it in a headless browser and saves the file that the app's own **Save** button makes. It does not screenshot the page: the editor on screen is a live `contenteditable`, and the exported image is drawn separately.

The scripts are in `scripts/` next to this file:

| Script | Needs | Does |
| --- | --- | --- |
| `link.mjs` | Node 18+ | Reads ANSI or text on stdin, prints a boron.sh link |
| `capture.js` | any browser tool that can run JS | Runs in the page, returns `{ dataUrl, link }` |
| `save.mjs` | Node 22+ and an installed Chrome, Chromium, Edge or Brave | Opens the link headless, runs `capture.js`, writes the file |

None of them needs an npm install.

## Step 1: Get the content

The content is raw terminal output, escape codes included. Keep the colors:

- **A command the agent can run:** force color, because most tools turn it off when stdout is not a terminal.
  ```bash
  FORCE_COLOR=1 CLICOLOR_FORCE=1 pnpm test > out.ansi 2>&1
  git -c color.ui=always log --oneline -10 > out.ansi
  ls --color=always > out.ansi
  ```
  If a tool still prints no color, run it under a pseudo-terminal: `script -q out.ansi <cmd>` on macOS, `script -qc "<cmd>" out.ansi` on Linux.
- **Code or plain text:** use it as is, and give a language in step 4. The app colors it with its own highlighter.
- **Output the user pasted, or output to mock up:** write the escape codes yourself, for example `printf '\e[32m✓\e[0m passed\n'`. Colors are chalk's sixteen names (SGR 30–37, 90–97 and the backgrounds), 256-color and truecolor. Modifiers are bold, dim, italic, underline, inverse, strikethrough and hidden.

A line that starts with `$`, `❯`, a bare `>` or `➜` is drawn as a command (bold), and the plain lines after it are dimmed. To make a prompt line, start it with `$ `.

## Step 2: Choose the settings

**Use the defaults below unless the user said otherwise.** Do not ask about each setting. After you save the image, tell the user which values you used and that they can change any of them.

| Flag for `link.mjs` | Values | Default |
| --- | --- | --- |
| `--theme` | `boron`, `vscode`, `dracula`, `tokyo-night`, `catppuccin-mocha`, `nord`, `one-dark`, `solarized-dark` | `boron` |
| `--backdrop` | `midnight`, `ember`, `mint`, `dusk`, `sand`, `arctic`, `graphite`, `ink`, `none` (transparent, but filled with the theme background in JPEG), or `#rrggbb` (flat fill) | `midnight` |
| `--title-bar` | `on`, `off` | `on` |
| `--title` | text in the title bar, 200 characters at most | empty |
| `--columns` | terminal width, 1–400. Longer lines wrap | `80` |
| `--aspect` | `og` (1200×630), `square` (1080×1080), `wide` (1920×1080), or leave out to fit the content | fit content |
| `--padding` | px around the window, 0–400. Ignored with `--aspect` | `48` |
| `--radius` | corner radius in px, 0–200 | `12` |
| `--shadow` | 0–100 | `100` |

Settings for `save.mjs` (they are not part of the link):

| Flag | Values | Default |
| --- | --- | --- |
| `--format` | `png`, `svg`, `jpeg`, `webp`. Raster images are 2x | `png` |
| `--language` | `typescript`, `javascript`, `python`, `rust`, `go`, `json`, `bash`, `yaml`, `sql` | none (content is used as is) |

Give `--language` only for plain code. Do not give it for output that already has ANSI colors, because it replaces them.

Set `--columns` to the width of the longest line if lines wrap where they should not. An unknown theme or backdrop falls back to the default, and values out of range are clamped, so check the spelling.

Save to the current working directory with a short name from the content or title, for example `./pnpm-test.png`, unless the user gave a path.

## Step 3: Make the link

```bash
node scripts/link.mjs --theme dracula --title "pnpm test" < out.ansi
# or
FORCE_COLOR=1 pnpm test 2>&1 | node scripts/link.mjs --title "pnpm test"
```

It prints one URL. If the URL is longer than 8000 characters, the parameters go after `#` instead of `?`. The app reads both.

To make a link without Node: `https://boron.sh/?v=1&content=u<base64url of the UTF-8 bytes>&theme=…`, with the flag names above in camelCase (`titleBar`, not `title-bar`) and URL-encoded values. The `u` before the base64url is required.

## Step 4: Save the image

### With `save.mjs` (default)

```bash
node <skill-dir>/scripts/save.mjs "$LINK" ./pnpm-test.png
node <skill-dir>/scripts/save.mjs "$LINK" ./fib.svg --format svg --language python
```

It starts the Chromium-based browser that is already installed, in headless mode with a new temporary profile, and controls it over the DevTools protocol. It uses only Node built-ins. It prints two lines: the saved path, and the link to the exported picture. If it does not find the browser, set `CHROME_PATH` to the browser's executable.

### With any other browser tool

If there is no Chromium-based browser, or you already have a browser tool (Playwright, Puppeteer, a browser MCP server, a CLI browser), use it instead. The tool must open a URL and evaluate async JavaScript:

1. Open the link in a **fresh** browser profile or context. A profile that visited boron.sh before also works, because the link has priority over the stored workspace.
2. Wait for the network to go idle.
3. Evaluate the contents of `scripts/capture.js`, called with the options, as one expression:
   ```js
   (<contents of capture.js>)({ format: "png", language: undefined })
   ```
   The snippet waits for the fonts and the layout. It returns `{ dataUrl, link }`.
4. Remove everything up to the first comma from `dataUrl`, and base64-decode the rest into the output file. For example: `sed 's/^data:[^,]*,//' | base64 -d > out.png`.

### Without a browser tool

Give the user the link. They open it and click **Save PNG** at the top right.

## Step 5: Report and stop

Tell the user:

1. The saved file path.
2. The link. It opens the same picture in the editor, where they can recolor text, change the theme or export again. Use the `link` that the capture returned: after `--language`, only that link has the syntax colors.
3. The settings you used, and that they can change any of them.

Then stop. Do not open or check the image again unless the user asks.

## Troubleshooting

- **"No Chrome, Chromium, Edge or Brave found":** set `CHROME_PATH`, or use another browser tool (step 4).
- **"Save button not ready":** the page did not load or the fonts did not arrive. Check the network, and try again.
- **"Menu item … not found" or "Syntax control not found":** the boron.sh UI changed. Give the user the link, and they can save the image manually.
- **No colors in the image:** the command wrote no escape codes. Check with `cat -v out.ansi | head`. You should see `^[[`. Force color (step 1).
- **Code without colors:** give `--language` to `save.mjs`. The `syntax` parameter in a link only affects the next paste, not the content of the link.
- **Empty rows at the bottom:** `link.mjs` removes trailing newlines. If you made the link by hand, remove them yourself.
- **Very long output:** a document can have 5000 lines at most. For an image, a few dozen lines is usually better. Cut the output to the part that matters.
