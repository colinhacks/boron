import type { ParsedLine, ParsedSpan } from "./ansi.ts";
import { nearestPaletteColor, parseCssColor, rgbToHex } from "./palette.ts";
import type { Color, Marks } from "./types.ts";

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "div", "dd", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tr", "ul",
]);

// A `display` declaration outranks the tag's default. Ghostty writes every
// styled run as a `<div style="display: inline">`, so going by the tag alone
// would break a line at every color change instead of at every terminal row.
const INLINE_DISPLAYS = new Set([
  "inline", "inline-block", "inline-flex", "inline-grid", "inline-table", "contents", "ruby",
]);
const BLOCK_DISPLAYS = new Set([
  "block", "flex", "grid", "flow-root", "list-item", "table", "table-row",
]);

interface Inherited {
  color: string | null;
  background: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  preserveWhitespace: boolean;
}

interface Declarations {
  [property: string]: string;
}

function parseInlineStyle(value: string): Declarations {
  const out: Declarations = {};
  for (const declaration of value.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const propertyValue = declaration.slice(colon + 1).trim();
    if (property) out[property] = propertyValue;
  }
  return out;
}

function normalizeColor(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "transparent" || trimmed === "inherit" || trimmed === "initial") return null;
  const rgb = parseCssColor(trimmed);
  return rgb ? rgbToHex(rgb) : null;
}

/**
 * Read what a terminal's clipboard HTML says about one element, layered on top
 * of what it inherited.
 */
function descend(element: Element, parent: Inherited, declarations: Declarations): Inherited {
  const next: Inherited = { ...parent };
  const tag = element.tagName.toLowerCase();

  if (tag === "b" || tag === "strong") next.bold = true;
  if (tag === "i" || tag === "em") next.italic = true;
  if (tag === "u" || tag === "ins") next.underline = true;
  if (tag === "s" || tag === "strike" || tag === "del") next.strikethrough = true;
  if (tag === "pre") next.preserveWhitespace = true;

  const fontColor = element.getAttribute("color");
  if (fontColor) next.color = normalizeColor(fontColor) ?? next.color;

  const color = normalizeColor(declarations["color"]);
  if (color) next.color = color;

  const background = normalizeColor(declarations["background-color"] ?? declarations["background"]);
  if (background) next.background = background;

  const weight = declarations["font-weight"];
  if (weight) {
    const numeric = Number.parseInt(weight, 10);
    if (weight === "bold" || weight === "bolder" || (Number.isFinite(numeric) && numeric >= 600)) next.bold = true;
    else if (weight === "normal" || (Number.isFinite(numeric) && numeric < 600)) next.bold = false;
  }

  const fontStyle = declarations["font-style"];
  if (fontStyle === "italic" || fontStyle === "oblique") next.italic = true;
  else if (fontStyle === "normal") next.italic = false;

  const decoration = `${declarations["text-decoration"] ?? ""} ${declarations["text-decoration-line"] ?? ""}`;
  if (decoration.includes("underline")) next.underline = true;
  if (decoration.includes("line-through")) next.strikethrough = true;

  // Several terminals render SGR 2 as reduced opacity rather than a dimmer color.
  const opacity = Number.parseFloat(declarations["opacity"] ?? "");
  if (Number.isFinite(opacity) && opacity < 0.9) next.dim = true;

  const whiteSpace = declarations["white-space"];
  if (whiteSpace) next.preserveWhitespace = whiteSpace.startsWith("pre");

  return next;
}

interface Collector {
  lines: ParsedSpan[][];
  current: ParsedSpan[];
}

function pushText(collector: Collector, text: string, style: Inherited, defaults: Defaults): void {
  if (text.length === 0) return;
  // A color the palette cannot read leaves the run uncolored rather than
  // carrying something no escape code can say.
  const named = (value: string | null, base: string | null): Color | null =>
    value && value !== base ? nearestPaletteColor(value, defaults.ansi16) : null;
  const fg = named(style.color, defaults.color);
  const bg = named(style.background, defaults.background);
  const marks: Marks = {
    ...(fg ? { fg } : {}),
    ...(bg ? { bg } : {}),
    ...(style.bold ? { bold: true as const } : {}),
    ...(style.dim ? { dim: true as const } : {}),
    ...(style.italic ? { italic: true as const } : {}),
    ...(style.underline ? { underline: true as const } : {}),
    ...(style.strikethrough ? { strikethrough: true as const } : {}),
  };
  collector.current.push({ text, marks });
}

function breakLine(collector: Collector): void {
  collector.lines.push(collector.current);
  collector.current = [];
}

interface Defaults {
  /** The wrapper's foreground — spans wearing it are treated as unstyled. */
  color: string | null;
  background: string | null;
  ansi16: readonly string[];
}

function walk(node: Node, style: Inherited, collector: Collector, defaults: Defaults): void {
  if (node.nodeType === 3 /* Text */) {
    const raw = node.nodeValue ?? "";
    const text = raw.replace(/\u00a0/g, " ");
    if (style.preserveWhitespace) {
      const parts = text.split("\n");
      parts.forEach((part, index) => {
        if (index > 0) breakLine(collector);
        pushText(collector, part, style, defaults);
      });
    } else {
      // Outside `white-space: pre`, a newline in the markup is source
      // formatting, not content — drop it along with the indentation it drags in.
      pushText(collector, text.replace(/[ \t]*[\r\n]+[ \t]*/g, ""), style, defaults);
    }
    return;
  }

  if (node.nodeType !== 1 /* Element */) return;
  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (tag === "script" || tag === "style" || tag === "head") return;
  if (tag === "br") {
    breakLine(collector);
    return;
  }

  const declarations = parseInlineStyle(element.getAttribute("style") ?? "");
  const display = (declarations["display"] ?? "").trim().toLowerCase();
  if (display === "none") return;

  const isBlock = INLINE_DISPLAYS.has(display) ? false : BLOCK_DISPLAYS.has(display) || BLOCK_TAGS.has(tag);
  if (isBlock && collector.current.length > 0) breakLine(collector);

  const next = descend(element, style, declarations);
  for (const child of Array.from(element.childNodes)) walk(child, next, collector, defaults);

  if (isBlock && collector.current.length > 0) breakLine(collector);
}

/**
 * Find the colors the *container* declares — the ones standing in for "no
 * color at all". Terminals wrap their clipboard HTML in one element carrying
 * the profile's default foreground and background, then color individual runs
 * on top; treating the wrapper's color as an explicit mark would put a color on
 * every character and switch the `$`-prompt styling off entirely.
 *
 * Only the chain of pure wrapper elements is inspected, and a leaf element
 * whose entire content is text is skipped — that is a styled run, not a
 * container, and its color is real.
 */
function findRootColors(body: Element): { color: string | null; background: string | null } {
  let color: string | null = null;
  let background: string | null = null;
  let current: Element | null = body;

  while (current) {
    const children: Node[] = Array.from(current.childNodes);
    const isStyledRun = children.length > 0 && children.every((node) => node.nodeType === 3);

    if (!isStyledRun) {
      const declarations = parseInlineStyle(current.getAttribute("style") ?? "");
      color ??= normalizeColor(declarations["color"]);
      background ??= normalizeColor(declarations["background-color"] ?? declarations["background"]);
    }

    const hasOwnText = children.some((node) => node.nodeType === 3 && (node.nodeValue ?? "").trim() !== "");
    const elementChildren: Element[] = Array.from(current.children);
    current = elementChildren.length === 1 && !hasOwnText ? elementChildren[0]! : null;
  }

  return { color, background };
}

/**
 * Turn a terminal's rich-text clipboard flavor into styled lines.
 *
 * Colors are mapped back onto named palette entries where they match a known
 * terminal palette, so a pasted green stays *green* and re-themes with the rest
 * of the block instead of freezing as one terminal's particular hex.
 *
 * Returns `null` when the markup carries no styling at all, which is the signal
 * to fall back to plain text and the `$`-prompt heuristic.
 */
export function parseHtmlClipboard(html: string, ansi16: readonly string[]): ParsedLine[] | null {
  if (!html.trim()) return null;

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const body = parsed.body;
  if (!body) return null;

  const root = findRootColors(body);
  const defaults: Defaults = { color: root.color, background: root.background, ansi16 };

  const collector: Collector = { lines: [], current: [] };
  const initial: Inherited = {
    color: null,
    background: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    preserveWhitespace: false,
  };

  for (const child of Array.from(body.childNodes)) walk(child, initial, collector, defaults);
  if (collector.current.length > 0) breakLine(collector);

  const lines: ParsedLine[] = collector.lines.map((spans) => ({
    spans: spans.length > 0 ? spans : [{ text: "", marks: {} }],
  }));

  while (lines.length > 0 && lines[lines.length - 1]!.spans.every((span) => span.text.trim() === "")) {
    lines.pop();
  }
  if (lines.length === 0) return null;

  const styled = lines.some((line) => line.spans.some((span) => Object.keys(span.marks).length > 0));
  return styled ? lines : null;
}
