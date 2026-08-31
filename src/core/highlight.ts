import type { Element, Root, RootContent } from "hast";
import bash from "highlight.js/lib/languages/bash";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import { namedColorSgr } from "./palette.ts";
import { classifyDocument, hasCommands } from "./prompt.ts";
import type { NamedColor } from "./types.ts";

/**
 * The languages Boron will highlight, and deliberately only these.
 *
 * A grammar is not free twice over. It is bundle weight — highlight.js ships
 * about 190 of them and all of them together cost some 310 KB gzipped against
 * 18 KB for these nine — but the expensive part is that *detection gets worse as
 * the set grows*, because `highlightAuto` scores the text against every grammar
 * registered and hands back the winner. Measured over a corpus of real snippets,
 * these nine detect correctly; widening the set to twenty-two turned a short
 * Python snippet into `ini`, and letting all 190 compete called TypeScript
 * `nim`, Python `livescript` and YAML `nestedtext`.
 *
 * So the bar for adding one is that people paste it into a terminal screenshot
 * often enough to pay for what it costs every *other* language's detection.
 */
const GRAMMARS = { typescript, javascript, python, rust, go, json, bash, yaml, sql };

export type LanguageId = keyof typeof GRAMMARS;

export const HIGHLIGHT_LANGUAGES: readonly { id: LanguageId; label: string }[] = [
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "json", label: "JSON" },
  { id: "bash", label: "Shell" },
  { id: "yaml", label: "YAML" },
  { id: "sql", label: "SQL" },
];

/**
 * What the syntax control is showing.
 *
 * `auto` is the default and means "detect on the next unstyled paste". `ansi`
 * is what a paste that *carried* escape codes selects: the colors came with the
 * text, they are the author's own, and no highlighter should second-guess them.
 * Anything else is a language the reader picked by hand.
 */
export type HighlightChoice = "auto" | "ansi" | LanguageId;

export function isLanguageId(value: string): value is LanguageId {
  return Object.hasOwn(GRAMMARS, value);
}

export function isHighlightChoice(value: unknown): value is HighlightChoice {
  return typeof value === "string" && (value === "auto" || value === "ansi" || isLanguageId(value));
}

const lowlight = createLowlight(GRAMMARS);

/**
 * highlight.js token scopes, mapped to chalk's sixteen names.
 *
 * Names rather than hex, for the reason the whole app is built on: a named color
 * re-maps when the reader switches theme, so a highlighted paste looks native in
 * Dracula and in Solarized alike. Resolving a TextMate theme to `#F97583` here
 * would freeze one editor's palette into the document and quietly break both
 * theme switching and the ANSI round-trip.
 *
 * Scopes left out are left *unstyled* on purpose. `params`, `punctuation` and
 * `operator` cover a lot of characters and coloring them is what makes a
 * highlighted block look like confetti rather than like code.
 */
const SCOPE_COLORS: Readonly<Record<string, NamedColor>> = {
  comment: "blackBright",
  quote: "blackBright",
  meta: "blackBright",

  keyword: "magenta",
  literal: "magenta",
  "selector-tag": "magenta",
  symbol: "magenta",

  string: "green",
  "meta string": "green",
  regexp: "green",
  addition: "green",

  number: "yellow",
  type: "yellow",
  "title class_": "yellow",
  "selector-class": "yellow",

  title: "blue",
  "title function_": "blue",
  "title function_ invoke__": "blue",
  section: "blue",

  built_in: "cyan",
  attr: "cyan",
  attribute: "cyan",
  "selector-attr": "cyan",

  variable: "red",
  "variable language_": "red",
  "template-variable": "red",
  deletion: "red",
};

const ESC = "\u001b";

/**
 * The scope for an element, as lowlight states it: `hljs-title function_` is the
 * two classes `hljs-title` and `function_`, and the specific pair is what the
 * sheet keys on. An unknown pair falls back to its first class, so a scope this
 * table has never heard of still picks up the color of its family.
 */
function scopeColor(element: Element): NamedColor | undefined {
  const classes = element.properties?.className;
  if (!Array.isArray(classes)) return undefined;
  const names = classes.map(String).map((name) => name.replace(/^hljs-/, ""));
  const first = names[0];
  if (first === undefined) return undefined;
  return SCOPE_COLORS[names.join(" ")] ?? SCOPE_COLORS[first];
}

/**
 * Walk the tree lowlight produced and write it back out as an escape sequence.
 *
 * Emitting ANSI rather than marks is the point: the result then goes through
 * `parseAnsi` like any other paste, so highlighted code arrives by exactly the
 * path pasted terminal output does and is never a special case. Tab stops, CRLF
 * and stray control characters are handled there, once — which matters here
 * because Go and Makefiles are full of real tabs.
 */
function toAnsi(node: RootContent | Root, inherited: NamedColor | undefined): string {
  if (node.type === "text") {
    if (!inherited) return node.value;
    return `${ESC}[${namedColorSgr(inherited)}m${node.value}${ESC}[39m`;
  }
  if (node.type !== "element" && node.type !== "root") return "";
  const color = node.type === "element" ? (scopeColor(node) ?? inherited) : inherited;
  return node.children.map((child) => toAnsi(child, color)).join("");
}

/** Highlight `code` as `language`, as a string of ANSI escape sequences. */
export function highlightToAnsi(code: string, language: LanguageId): string {
  return toAnsi(lowlight.highlight(language, code), undefined);
}

/**
 * How sure `highlightAuto` has to be before an unstyled paste is recolored.
 *
 * Relevance is a comparative score across the *registered* grammars rather than
 * a probability, which is why keeping `GRAMMARS` small pays off twice. Measured
 * over the same corpus against all 190 grammars, `curl`'s progress meter scored
 * 12 as Ruby and a stack trace scored 6 as PHP — both above anything a threshold
 * could exclude without losing real code. Against these nine the same samples
 * score 3 and 3, because the grammars that found them interesting are not in the
 * room: terminal output now lands at 0-3 and code at 5-11.
 *
 * Five is the floor of the code band, and it clears the ceiling of the non-code
 * band by two. Widen `GRAMMARS` and this number is no longer safe.
 */
const MIN_RELEVANCE = 5;

/**
 * Detection runs over the head of the paste rather than all of it. Scoring is
 * one pass per registered grammar, and a five-thousand-line paste would pay that
 * nine times to answer a question the first hundred lines already settle.
 */
const DETECT_LINES = 100;

/**
 * Terminal output, as opposed to source code someone pasted.
 *
 * The `$`-prompt heuristic is the cheap, precise signal Boron already has: a
 * block with a command line in it came off a terminal, whatever a grammar scores
 * it, and recoloring somebody's `git status` as SQL is a worse failure than
 * declining to highlight a snippet that happens to open with `$`.
 */
function looksLikeTranscript(text: string): boolean {
  return hasCommands(classifyDocument(text.split("\n")));
}

/**
 * The language for an unstyled paste, or `null` to leave it alone.
 *
 * Only ever called for text with no escape codes in it — a paste that names its
 * own colors keeps them, and selects `ansi` on the control instead.
 */
export function detectLanguage(text: string): LanguageId | null {
  if (text.trim().length === 0) return null;
  if (looksLikeTranscript(text)) return null;

  const sample = text.split("\n").slice(0, DETECT_LINES).join("\n");
  const result = lowlight.highlightAuto(sample);
  const language = result.data?.language;
  const relevance = result.data?.relevance ?? 0;

  if (!language || !isLanguageId(language)) return null;
  return relevance >= MIN_RELEVANCE ? language : null;
}

/**
 * Detect and highlight in one step: the ANSI for an unstyled paste that looks
 * like code, or `null` when it should be left exactly as it arrived.
 */
export function autoHighlight(text: string): { language: LanguageId; ansi: string } | null {
  const language = detectLanguage(text);
  if (!language) return null;
  return { language, ansi: highlightToAnsi(text, language) };
}
