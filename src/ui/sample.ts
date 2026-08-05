import { parseAnsi } from "../core/ansi.ts";
import { parsedLinesToDocument, type TerminalDocument } from "../core/document.ts";

const E = "\u001b";
const reset = `${E}[0m`;
const wrap = (codes: string) => (text: string) => `${E}[${codes}m${text}${reset}`;

const red = wrap("31");
const green = wrap("32");
const yellow = wrap("33");
const blue = wrap("34");
const dim = wrap("2");
const bold = wrap("1");
const boldGreen = wrap("1;32");
const boldCyan = wrap("1;36");
const boldMagenta = wrap("1;35");
/** An underlined link, which is what a modern dev server prints. */
const link = wrap("4;36");
const white = wrap("37");
/** Black on green: the status-badge shape most CLIs land on. */
const badge = wrap("1;30;42");

/**
 * The starting document, written as real ANSI and run through the parser — the
 * same path a paste takes, so the demo content is never a special case.
 *
 * It is the same session as the Open Graph card in `scripts/og-card.html`,
 * and for the same reason: between them these lines exercise bold, dim, six
 * hues, underlines and a filled badge, so the first thing anyone sees is a
 * demonstration of what Boron can actually render.
 *
 * Note the `➜` placement — the prompt owns column 0, while the arrows bulleting
 * the server's own output are indented, which is exactly how `prompt.ts` tells
 * a command from output.
 */
const SAMPLE_ANSI = [
  `${boldGreen("➜")}  ${boldCyan("boron")} ${blue("git:(")}${red("main")}${blue(")")} ${yellow("✗")} ${bold("nub run dev")}`,
  "",
  `  ${boldMagenta("FRIZZ")} ${dim("v0.1.7")}  ${dim("ready in 1.24s")}`,
  "",
  `  ${green("➜")}  ${bold("Local:")}    ${link("http://127.0.0.1:4922/")}`,
  `  ${green("➜")}  ${bold("Network:")}  ${link("http://192.168.1.24:4922/")}`,
  `  ${green("➜")}  ${bold("Project:")}  ${white("boron")} ${dim("— ~/Documents/projects/boron")}`,
  "",
  `  ${green("✓")} 85 passed   ${yellow("⚠")} ${dim("2 warnings")}   ${red("✗")} ${dim("0 failed")}`,
  "",
  `  ${badge(" READY ")} ${dim("watching for changes — press")} ${bold("q")} ${dim("to quit")}`,
].join("\n");

export function sampleDocument(): TerminalDocument {
  return parsedLinesToDocument(parseAnsi(SAMPLE_ANSI));
}
