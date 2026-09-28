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
 * No dependencies, so any agent with Node can run it.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const MAX_QUERY_URL_LENGTH = 8_000;

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
    columns: { type: "string" },
    aspect: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(
    "Usage: node link.mjs [--theme id] [--backdrop id|none|#rrggbb] [--syntax auto|ansi|lang] " +
      "[--padding px] [--radius px] [--title-bar on|off] [--title text] [--shadow 0-100] " +
      "[--columns n] [--aspect og|square|wide] [--base url] < output.ansi",
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
for (const [flag, param] of Object.entries(SETTINGS)) {
  if (values[flag] !== undefined) params.set(param, values[flag]);
}

const base = new URL(values.base);
base.search = "";
base.hash = "";
const query = `${base.href}?${params}`;
console.log(query.length <= MAX_QUERY_URL_LENGTH ? query : `${base.href}#${params}`);
