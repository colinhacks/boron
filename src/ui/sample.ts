import { parseAnsi } from "../core/ansi.ts";
import { parsedLinesToDocument, type TerminalDocument } from "../core/document.ts";

const E = "\u001b";
const reset = `${E}[0m`;
const green = (text: string) => `${E}[32m${text}${reset}`;
const cyan = (text: string) => `${E}[36m${text}${reset}`;
const yellow = (text: string) => `${E}[33m${text}${reset}`;
const magenta = (text: string) => `${E}[35m${text}${reset}`;
const boldGreen = (text: string) => `${E}[1;32m${text}${reset}`;
const dim = (text: string) => `${E}[2m${text}${reset}`;

/**
 * The starting document, written as real ANSI and run through the parser — the
 * same path a paste takes, so the demo content is never a special case.
 */
const SAMPLE_ANSI = [
  "$ nub run build",
  "",
  dim("> boron@0.1.0 build"),
  dim("> vite build"),
  "",
  `${magenta("vite")} v8.2.0 ${dim("building for production...")}`,
  `${green("✓")} 143 modules transformed.`,
  `${cyan("dist/index.html")}                  ${dim("0.46 kB │ gzip:  0.30 kB")}`,
  `${cyan("dist/assets/index-BqT9xkPz.css")}   ${dim("6.12 kB │ gzip:  1.94 kB")}`,
  `${cyan("dist/assets/index-Cw2mNq7f.js")}  ${dim("248.71 kB │ gzip: 79.35 kB")}`,
  `${green("✓")} built in ${yellow("1.24s")}`,
  "",
  "$ boron deploy --prod",
  `${green("✔")} Uploading assets`,
  `${green("✔")} Invalidating CDN`,
  `${boldGreen("✔")} Live at ${cyan("https://boron.sh")}`,
].join("\n");

export function sampleDocument(): TerminalDocument {
  return parsedLinesToDocument(parseAnsi(SAMPLE_ANSI));
}
