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

/** The display name for a language, for the control and the paste toast alike. */
export function languageLabel(id: LanguageId): string {
  return HIGHLIGHT_LANGUAGES.find((language) => language.id === id)?.label ?? id;
}

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
 * The hues are the plurality choice across nine established themes — VS Code
 * Dark+, Dracula, One Dark, Tokyo Night, Catppuccin Mocha, Nord, Solarized Dark,
 * GitHub Dark and Monokai. Where they genuinely disagree, the note on the entry
 * says so and says who dissents.
 *
 * **What is missing from this table matters more than what is in it.** Those
 * nine themes color five or six categories and no more: comments, keywords,
 * strings, numbers and other constants, function names, and usually types.
 * Plain variables, parameters, object keys, property access, operators and
 * punctuation are left as ordinary foreground text by the majority of them, so
 * they are absent here. Coloring those is what makes highlighted code read as
 * confetti rather than as prose with a few words emphasized, and it is the
 * single easiest thing to get wrong: highlight.js offers a scope for everything,
 * and taking it up on all of them is not a palette, it is a rainbow.
 */
const SCOPE_COLORS: Readonly<Record<string, NamedColor>> = {
  // Near-unanimous: 8 of 9. Only Dark+ dissents, with green.
  comment: "blackBright",
  quote: "blackBright",
  // Shebangs, decorators, `"use strict"`. Chrome around the code rather than
  // code, so it recedes with the comments.
  meta: "blackBright",

  // Plurality, 5 of 9. GitHub and Monokai use red, Nord blue, Solarized green.
  keyword: "magenta",
  // `this`, `self`, `super` — a keyword wearing an identifier's clothes.
  "variable language_": "magenta",

  // Plurality, 4 of 9, and the most legible of the candidates on a dark
  // terminal. Dracula and Monokai use yellow, Dark+ orange, Solarized cyan.
  string: "green",
  // A regex literal is a literal; it travels with strings in most themes.
  regexp: "green",

  // Constants share one hue. Themes split on which — 4 of 9 say purple, 3 say
  // orange — and purple is unavailable here because it is already the keyword,
  // so this follows One Dark, Tokyo Night and Catppuccin. Booleans and `null`
  // take the number's colour in 6 of 9, so they are here too.
  number: "yellow",
  literal: "yellow",
  "variable constant_": "yellow",
  symbol: "yellow",

  // Plurality, 4 of 9. Declaration and call site are the same colour in all
  // nine, so there is only one entry to make.
  "title function_": "blue",
  title: "blue",

  // Majority, 5 of 9, for built-ins. Types and classes are the one genuinely
  // three-way split — cyan 3, yellow 2, orange 2 — and cyan wins on more than
  // the count: highlight.js decides "class" from *capitalisation alone*, so a
  // plain `const Event = …` is scored as one. Cyan reads as a type reference
  // when that guess is right and as nothing much when it is wrong, where yellow
  // shouts either way.
  built_in: "cyan",
  "title class_": "cyan",
  type: "cyan",
};

/**
 * Where one language needs a scope read differently from the rest.
 *
 * Kept to the cases where the same highlight.js scope means a different thing
 * in a different language, rather than as a place to hang per-language taste.
 */
const LANGUAGE_OVERRIDES: Readonly<Partial<Record<LanguageId, Readonly<Record<string, NamedColor>>>>> = {
  /**
   * Keys are structure in a config file and decoration in a program, and
   * highlight.js spells both `attr` — so the scope cannot separate them but the
   * language can. Leaving a JSON document's keys unstyled renders a wall of
   * plain text with a few green values in it, while an object literal's keys in
   * JavaScript are ordinary code that six of the nine themes leave alone.
   *
   * `keyword` is remapped for the same reason: the only keywords JSON has are
   * `true`, `false` and `null`, which are constants rather than syntax, and
   * booleans take the number's colour in six of the nine themes.
   */
  json: { attr: "cyan", keyword: "yellow" },
  yaml: { attr: "cyan" },
};

const ESC = "\u001b";

/**
 * The scope for an element, as lowlight states it: `hljs-title function_` is the
 * two classes `hljs-title` and `function_`, and the specific pair is what the
 * sheet keys on. An unknown pair falls back to its first class, so a scope this
 * table has never heard of still picks up the color of its family.
 */
function scopeColor(element: Element, sheet: Readonly<Record<string, NamedColor>>): NamedColor | undefined {
  const classes = element.properties?.className;
  if (!Array.isArray(classes)) return undefined;
  const names = classes.map(String).map((name) => name.replace(/^hljs-/, ""));
  // Narrowest match first, then drop qualifiers from the right: highlight.js
  // states a scope as a chain, and `title class_ inherited__` is a class before
  // it is a title. Falling straight back to the first class would paint an
  // inherited class name with the function colour.
  for (let end = names.length; end > 0; end -= 1) {
    const color = sheet[names.slice(0, end).join(" ")];
    if (color) return color;
  }
  return undefined;
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
function toAnsi(
  node: RootContent | Root,
  inherited: NamedColor | undefined,
  sheet: Readonly<Record<string, NamedColor>>,
): string {
  if (node.type === "text") {
    if (!inherited) return node.value;
    return `${ESC}[${namedColorSgr(inherited)}m${node.value}${ESC}[39m`;
  }
  if (node.type !== "element" && node.type !== "root") return "";
  const color = node.type === "element" ? (scopeColor(node, sheet) ?? inherited) : inherited;
  return node.children.map((child) => toAnsi(child, color, sheet)).join("");
}

/** Highlight `code` as `language`, as a string of ANSI escape sequences. */
export function highlightToAnsi(code: string, language: LanguageId): string {
  const overrides = LANGUAGE_OVERRIDES[language];
  const sheet = overrides ? { ...SCOPE_COLORS, ...overrides } : SCOPE_COLORS;
  return toAnsi(lowlight.highlight(language, code), undefined, sheet);
}

/**
 * When `highlightAuto`'s score is high enough to stand on its own.
 *
 * Relevance is a comparative sum across the registered grammars, not a
 * probability, and on a realistic corpus the two populations overlap: code runs
 * 2-6 and terminal output 0-4. A threshold strict enough to exclude the output
 * (5) fires on only two of twelve real snippets, which is a feature that may as
 * well not exist. So this is the *confident* branch, and `looksStructural`
 * below is what catches the rest.
 */
const MIN_RELEVANCE = 5;

/**
 * Punctuation that carries syntax rather than prose. Code is dense in it and a
 * log line is not — the clearest single difference between the two.
 */
const SYNTAX_PUNCTUATION = /[{}()[\];=<>|&/*+\-_.:,"'`$#!?%^~\\@]/g;

/**
 * The structural branch, and the thresholds are fitted rather than derived.
 *
 * Two signals, both cheap and both explainable: a code line tends to *close* on
 * a structural token (`{`, `;`, `:`, `,`, a bracket), and code is punctuation
 * dense. Neither is sufficient alone — a stack trace ends lines on `)` and test
 * output ends them on `)` too, but both are prose-dense and fail the second
 * test.
 *
 * Together with `MIN_RELEVANCE` they take eleven of twelve code samples with no
 * false positive across thirteen kinds of real terminal output. The numbers come
 * off that corpus, which lives in `highlight.test.ts` — it is the specification
 * for these constants, so move one and the corpus tells you what it cost.
 */
const MIN_TERMINATOR_RATIO = 0.6;
const MIN_PUNCTUATION_DENSITY = 0.17;

function looksStructural(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return false;

  const closing = lines.filter((line) => /[{}()[\];:,=]$/.test(line)).length;
  if (closing / lines.length < MIN_TERMINATOR_RATIO) return false;

  const dense = text.replace(/\s/g, "");
  if (dense.length === 0) return false;
  const punctuation = dense.match(SYNTAX_PUNCTUATION)?.length ?? 0;
  return punctuation / dense.length >= MIN_PUNCTUATION_DENSITY;
}

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
  if (relevance >= MIN_RELEVANCE) return language;
  return looksStructural(sample) ? language : null;
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
