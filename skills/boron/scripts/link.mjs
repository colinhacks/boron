#!/usr/bin/env node
/**
 * Prints a boron.sh link for terminal output read from stdin.
 *
 *   FORCE_COLOR=1 pnpm test | node link.mjs --theme dracula --title "pnpm test"
 *
 * The content travels uncompressed (`u` + base64url of the raw bytes), which
 * every reader accepts. Settings left out are not written: an unsaid setting
 * resolves through frozen defaults, so the link still renders the same picture
 * for everyone. Past MAX_QUERY_URL_LENGTH the parameters move to the fragment,
 * which has no practical length limit.
 *
 * `--columns` defaults to `auto`: the width of the longest visible line, kept
 * between MIN_COLUMNS and MAX_COLUMNS, so output wider than a default terminal
 * does not wrap in the picture.
 *
 * No dependencies, so any agent with Node can run it.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const MAX_QUERY_URL_LENGTH = 8_000;
/** The app's default width, and the widest block a link may ask for. */
const MIN_COLUMNS = 80;
const MAX_COLUMNS = 400;
const TAB_STOP = 8;

/** CSI and OSC sequences, then any other two-byte escape. None of them take a cell. */
const ESCAPES = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

/**
 * Cells per line, counted the way the app wraps: one per code point, with tabs
 * expanded to the next stop. Other control characters take no cell.
 */
function visibleWidth(line) {
  let width = 0;
  for (const char of line.replace(ESCAPES, "")) {
    if (char === "\t") width += TAB_STOP - (width % TAB_STOP);
    else if (char >= " " && char !== "\x7f") width += 1;
  }
  return width;
}

function autoColumns(content) {
  const widest = Math.max(...content.split("\n").map(visibleWidth));
  return Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, widest));
}

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "https://boron.sh/" },
    theme: { type: "string" },
    backdrop: { type: "string" },
    syntax: { type: "string" },
    padding: { type: "string" },
    radius: { type: "string" },
    "title-bar": { type: "string" },
    title: { type: "string" },
    shadow: { type: "string" },
    columns: { type: "string", default: "auto" },
    aspect: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(
    "Usage: node link.mjs [--theme id] [--backdrop id|none|#rrggbb] [--syntax auto|ansi|lang] " +
      "[--padding px] [--radius px] [--title-bar on|off] [--title text] [--shadow 0-100] " +
      "[--columns auto|n] [--aspect og|square|wide] [--base url] < output.ansi",
  );
  process.exit(0);
}

/** Trailing newlines would become empty rows at the bottom of the block. */
const content = readFileSync(0, "utf8").replace(/\n+$/, "");
if (content === "") {
  console.error("link.mjs: no content on stdin");
  process.exit(1);
}

const params = new URLSearchParams();
params.set("v", "1");
params.set("content", `u${Buffer.from(content, "utf8").toString("base64url")}`);

const SETTINGS = {
  theme: "theme",
  backdrop: "backdrop",
  syntax: "syntax",
  padding: "padding",
  radius: "radius",
  "title-bar": "titleBar",
  title: "title",
  shadow: "shadow",
  columns: "columns",
  aspect: "aspect",
};
if (values.columns === "auto") values.columns = String(autoColumns(content));
for (const [flag, param] of Object.entries(SETTINGS)) {
  if (values[flag] !== undefined) params.set(param, values[flag]);
}

const base = new URL(values.base);
base.search = "";
base.hash = "";
const query = `${base.href}?${params}`;
console.log(query.length <= MAX_QUERY_URL_LENGTH ? query : `${base.href}#${params}`);
