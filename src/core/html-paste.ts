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
  /**
   * The colors the nearest block ancestor declared, as opposed to the ones a run
   * put on itself. A color on a row is a backdrop the whole row sits on; a color
   * on a run is the terminal actually saying something.
   */
  rowColor: string | null;
  rowBackground: string | null;
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

interface StyleRule {
  selector: string;
  declarations: Declarations;
  specificity: number;
  order: number;
}

/** Approximate CSS specificity — enough to order rules that target one element. */
function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/[.:[][\w-]+/g) ?? []).length;
  const tags = (selector.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10000 + classes * 100 + tags;
}

/**
 * The rules in the document's `<style>` blocks, in cascade order.
 *
 * Terminals that write their own clipboard HTML put everything in a `style`
 * attribute, so for a long time reading that attribute was enough. macOS's
 * RTF-to-HTML conversion does not: it emits `p.p1 { color: … }` into a
 * stylesheet and leaves the elements carrying nothing but a class. Every
 * terminal that writes RTF and no HTML — Terminal.app, iTerm2 — arrives in that
 * shape, and going by the attribute alone drops every color they send.
 */
function collectRules(doc: Document): StyleRule[] {
  const rules: StyleRule[] = [];
  for (const style of Array.from(doc.getElementsByTagName("style"))) {
    // Comments go first so a commented-out brace cannot unbalance the split.
    const css = (style.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    const block = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = block.exec(css))) {
      const declarations = parseInlineStyle(match[2] ?? "");
      for (const selector of (match[1] ?? "").split(",")) {
        const trimmed = selector.trim();
        // At-rules carry their own nested blocks and their own conditions, and
        // neither survives a flat scan like this one.
        if (!trimmed || trimmed.startsWith("@")) continue;
        rules.push({ selector: trimmed, declarations, specificity: specificity(trimmed), order: rules.length });
      }
    }
  }
  return rules;
}

/** What the stylesheet and the `style` attribute together say about one element. */
function declarationsFor(element: Element, rules: readonly StyleRule[]): Declarations {
  const inline = parseInlineStyle(element.getAttribute("style") ?? "");
  if (rules.length === 0) return inline;

  const matched = rules.filter((rule) => {
    try {
      return element.matches(rule.selector);
    } catch {
      // A selector this DOM cannot parse simply does not apply.
      return false;
    }
  });
  matched.sort((a, b) => a.specificity - b.specificity || a.order - b.order);

  const out: Declarations = {};
  for (const rule of matched) Object.assign(out, rule.declarations);
  // The attribute outranks anything the stylesheet said.
  return Object.assign(out, inline);
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
function descend(
  element: Element,
  parent: Inherited,
  declarations: Declarations,
  isContainer: boolean,
): Inherited {
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

  if (isContainer) {
    if (color) next.rowColor = color;
    if (background) next.rowBackground = background;
  }

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

/**
 * A run of text with the styling that reached it.
 *
 * Held raw rather than converted to marks on the spot, because which colors
 * count as "no color at all" is not known until the whole document has been
 * read — see `defaultColors`.
 */
interface Run {
  text: string;
  style: Inherited;
}

interface Collector {
  lines: Run[][];
  current: Run[];
}

function pushText(collector: Collector, text: string, style: Inherited): void {
  if (text.length === 0) return;
  collector.current.push({ text, style });
}

function toSpan(run: Run, defaults: Defaults): ParsedSpan {
  const { style } = run;
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
  return { text: run.text, marks };
}

function breakLine(collector: Collector): void {
  collector.lines.push(collector.current);
  collector.current = [];
}

interface Defaults {
  /** The foreground standing in for "no color" — runs wearing it are unstyled. */
  color: string | null;
  background: string | null;
  ansi16: readonly string[];
}

function walk(node: Node, style: Inherited, collector: Collector, rules: readonly StyleRule[]): void {
  if (node.nodeType === 3 /* Text */) {
    const raw = node.nodeValue ?? "";
    const text = raw.replace(/\u00a0/g, " ");
    if (style.preserveWhitespace) {
      const parts = text.split("\n");
      parts.forEach((part, index) => {
        if (index > 0) breakLine(collector);
        pushText(collector, part, style);
      });
    } else {
      // Outside `white-space: pre`, a newline in the markup is *usually* source
      // formatting, not content — drop it along with the indentation it drags
      // in. Where it was content after all, the whole document is read a second
      // time with this branch switched off and the plain flavour picks the
      // winner; see `preservingWhitespace`.
      pushText(collector, text.replace(/[ \t]*[\r\n]+[ \t]*/g, ""), style);
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

  const declarations = declarationsFor(element, rules);
  const display = (declarations["display"] ?? "").trim().toLowerCase();
  if (display === "none") return;

  const isBlock = INLINE_DISPLAYS.has(display) ? false : BLOCK_DISPLAYS.has(display) || BLOCK_TAGS.has(tag);
  if (isBlock && collector.current.length > 0) breakLine(collector);

  // Same distinction `findRootColors` draws: an element whose entire content is
  // text is a styled run, not a row, however it is displayed — so its color is
  // something the terminal said and not a backdrop to discount.
  //
  // What makes a color a backdrop is being a CONTAINER, not being a block, and
  // the two are not the same thing once the markup has been through a clipboard.
  // Chrome serializes computed styles into the `style` attribute but omits
  // `display`, so a docs site whose rows are `<span>`s made block by a stylesheet
  // arrives as plain inline spans — and gating this on `isBlock` then read the
  // page's own background as something the author said about every character.
  // A nubjs.com code block came through with `bg` on all 1799 of them.
  const children = Array.from(element.childNodes);
  const isStyledRun = children.length > 0 && children.every((child) => child.nodeType === 3);
  const next = descend(element, style, declarations, !isStyledRun);
  for (const child of Array.from(element.childNodes)) walk(child, next, collector, rules);

  if (isBlock && collector.current.length > 0) breakLine(collector);
}

/** The rows a flavour states, with the trailing blank ones a copy always drags in dropped. */
function contentRows(text: string): string[] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  while (rows.length > 0 && rows[rows.length - 1]!.trim() === "") rows.pop();
  return rows;
}

/** Read the whole document, with `white-space` starting at the given value. */
function collectLines(
  body: Element,
  rules: readonly StyleRule[],
  preserveWhitespace: boolean,
): Run[][] {
  const collector: Collector = { lines: [], current: [] };
  const initial: Inherited = {
    color: null,
    background: null,
    rowColor: null,
    rowBackground: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    preserveWhitespace,
  };
  for (const child of Array.from(body.childNodes)) walk(child, initial, collector, rules);
  if (collector.current.length > 0) breakLine(collector);
  return collector.lines;
}

/**
 * A second reading of the same markup that believes its newlines.
 *
 * `walk` drops a newline outside `white-space: pre`, which is what a browser
 * does and what pretty-printed markup needs — Terminal.app's HTML puts one
 * between every `<p>` and none of them are rows. But a selection made *inside* a
 * `<pre>` arrives without the `<pre>`: Chromium serializes the fragment, and a
 * fragment that starts and ends within one element carries none of the element's
 * own styling. A Shiki code block copied that way is a flat run of
 * `<span style="color: …">` with literal newlines between the rows and nothing
 * anywhere saying that whitespace is significant — so every row of it was being
 * folded onto one line, indentation and all.
 *
 * `relineFromPlainText` cannot repair that on its own: it cuts on offsets, so it
 * first demands the markup say character for character what the plain flavour
 * says, and the dropped newline takes each row's indentation with it. Reading
 * the document again with the branch switched off restores both at once, and the
 * plain flavour says which of the two readings was right.
 *
 * Only ever accepted on an exact match, which is what keeps it from inventing
 * rows in markup whose newlines really were formatting. Terminal.app's reading
 * gains a blank row per `<p>` boundary under this rule, disagrees, and is
 * discarded.
 */
function preservingWhitespace(
  body: Element,
  rules: readonly StyleRule[],
  plain: string,
): Run[][] | null {
  const lines = collectLines(body, rules, true);
  const rows = lines.map((line) => line.map((run) => run.text).join(""));
  return contentRows(rows.join("\n")).join("\n") === contentRows(plain).join("\n") ? lines : null;
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
function findRootColors(
  body: Element,
  rules: readonly StyleRule[],
): { color: string | null; background: string | null } {
  let color: string | null = null;
  let background: string | null = null;
  let current: Element | null = body;

  while (current) {
    const children: Node[] = Array.from(current.childNodes);
    const isStyledRun = children.length > 0 && children.every((node) => node.nodeType === 3);

    if (!isStyledRun) {
      const declarations = declarationsFor(current, rules);
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
 * The colors standing in for "no color at all" when there is no wrapper to read
 * them off.
 *
 * macOS's RTF-to-HTML conversion offers nothing for `findRootColors` to walk: it
 * emits one `<p>` per row directly under `<body>`, and hangs the profile's
 * colors on every one of them. What is left is a frequency signal. A color a
 * *row* declares is a backdrop the whole row sits on rather than the terminal
 * saying something, so the row color most of the text is sitting on is the one
 * to treat as unstyled.
 *
 * Deliberately reads only row-declared colors, never a run's own. Markup that
 * colors individual runs and nothing else — which is most terminals, and every
 * hand-written snippet — offers no candidates here and is left exactly as it
 * was, with every one of its colors intact.
 */
function defaultColors(lines: readonly Run[][]): { color: string | null; background: string | null } {
  const colors = new Map<string, number>();
  const backgrounds = new Map<string, number>();

  for (const line of lines) {
    for (const run of line) {
      if (run.text.length === 0) continue;
      const { rowColor, rowBackground } = run.style;
      if (rowColor) colors.set(rowColor, (colors.get(rowColor) ?? 0) + run.text.length);
      if (rowBackground) backgrounds.set(rowBackground, (backgrounds.get(rowBackground) ?? 0) + run.text.length);
    }
  }

  const commonest = (counts: Map<string, number>): string | null => {
    let best: string | null = null;
    let bestCount = 0;
    for (const [value, count] of counts) {
      if (count > bestCount) [best, bestCount] = [value, count];
    }
    return best;
  };

  return { color: commonest(colors), background: commonest(backgrounds) };
}

/**
 * The one background every run states, if they all state the same one.
 *
 * Chrome writes *computed* styles into the clipboard, so a code block copied off
 * a web page arrives as a flat run of sibling `<span>`s that each restate the
 * block's background. There is no container for `findRootColors` to read it off
 * and no row declaring it for `defaultColors` to count, so both of the existing
 * defences miss it and the paste paints another site's backdrop onto every
 * character. A VitePress block came through with `bg` on all four of its runs.
 *
 * Backgrounds only. A terminal uses one to mark out a *part* of its output — a
 * badge, a diff hunk, a selection — so one covering every character is a surface
 * rather than something the source said. A foreground is how a terminal says
 * anything at all, and two adjacent runs sharing one is ordinary, so the same
 * reasoning does not carry over to it.
 *
 * A lone run is left alone, having nothing to be uniform against. That is the
 * ` FAIL ` badge copied on its own, which is all background and means it.
 */
function uniformBackground(lines: readonly Run[][]): string | null {
  let background: string | null = null;
  let runs = 0;
  for (const line of lines) {
    for (const run of line) {
      if (run.text.length === 0) continue;
      if (!run.style.background) return null;
      if (background !== null && run.style.background !== background) return null;
      background = run.style.background;
      runs++;
    }
  }
  return runs > 1 ? background : null;
}

/**
 * The rows the markup lost, taken from the plain-text flavour.
 *
 * A clipboard states its rows twice — once as markup, once as newlines in
 * `text/plain` — and the second one cannot be mangled. The first one can: Chrome
 * writes computed styles into the `style` attribute but **omits `display`**, so
 * a page whose rows are `<span>`s made block by a stylesheet arrives as a run of
 * plain inline spans with no row boundary anywhere in it. That is the ordinary
 * shape of a syntax-highlighted code block on a docs site — Shiki emits exactly
 * it — and a nubjs.com block came through as one 1799-character line.
 *
 * There is nothing left in such markup to recognize: no `<br>`, no newline, no
 * `display`, and a class name is the site's business rather than a contract. So
 * the text is what settles it. Each flavour is believed about what it alone
 * knows — the markup about styling, the plain text about where the lines are.
 *
 * Applied only when the two agree character for character, which makes it a
 * no-op wherever the markup already got its rows right: cutting at the same
 * offsets returns what it was handed. Where they disagree the markup is left
 * exactly as it was, because then the plain text is describing something else
 * and its newlines say nothing about these runs.
 */
function relineFromPlainText(lines: readonly ParsedLine[], plain: string): readonly ParsedLine[] {
  const rows = contentRows(plain);
  // Only ever adds rows. Fewer would mean the plain text is the poorer account.
  if (rows.length <= lines.length) return lines;

  const spans = lines.flatMap((line) => line.spans);
  if (spans.map((span) => span.text).join("") !== rows.join("")) return lines;

  const out: ParsedLine[] = [];
  let index = 0;
  let offset = 0;
  for (const row of rows) {
    const cut: ParsedSpan[] = [];
    let remaining = row.length;
    while (remaining > 0 && index < spans.length) {
      const span = spans[index]!;
      const take = Math.min(remaining, span.text.length - offset);
      if (take > 0) cut.push({ text: span.text.slice(offset, offset + take), marks: { ...span.marks } });
      offset += take;
      remaining -= take;
      if (offset >= span.text.length) {
        index++;
        offset = 0;
      }
    }
    // An empty row still occupies one, the same as everywhere else here.
    out.push({ spans: cut.length > 0 ? cut : [{ text: "", marks: {} }] });
  }
  return out;
}

/**
 * Drop the padding a terminal wrote out to its window edge.
 *
 * `parseAnsi` already does this — "a terminal pads its rows out to the window and
 * none of it is content" — and the rich-text flavour needs it for the same reason
 * and by the same rule. xterm.js is the terminal inside VS Code, Cursor, Hyper
 * and Tabby, and its serializer pads every row out to the full column count, so
 * without this a five-line copy arrives a hundred characters wide and drags the
 * block's width with it.
 *
 * A trailing space wearing a background or an underline is not padding — the
 * terminal is drawing with it — so it stays, which is the same line `parseAnsi`
 * draws in `isTrimmableCell`.
 */
function trimTrailingPadding(line: ParsedLine): ParsedLine {
  const spans = line.spans.map((span) => ({ ...span }));
  while (spans.length > 0) {
    const span = spans[spans.length - 1]!;
    if (span.marks.bg !== undefined || span.marks.underline) break;
    const trimmed = span.text.replace(/ +$/, "");
    if (trimmed === span.text) break;
    span.text = trimmed;
    if (trimmed.length > 0) break;
    spans.pop();
  }
  return { spans: spans.length > 0 ? spans : [{ text: "", marks: {} }] };
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
export function parseHtmlClipboard(
  html: string,
  ansi16: readonly string[],
  /** The same copy's `text/plain`, which is the authority on where the rows are. */
  plain?: string,
): ParsedLine[] | null {
  if (!html.trim()) return null;

  const parsed = new DOMParser().parseFromString(html, "text/html");
  const body = parsed.body;
  if (!body) return null;

  const rules = collectRules(parsed);
  const root = findRootColors(body, rules);

  // The markup's own newlines, where the plain flavour vouches for them; what a
  // browser would render otherwise.
  const collected =
    (plain ? preservingWhitespace(body, rules, plain) : null) ?? collectLines(body, rules, false);

  // The wrapper wins where there is one; the rows only stand in for it when
  // there is not.
  const fallback = defaultColors(collected);
  const defaults: Defaults = {
    color: root.color ?? fallback.color,
    background: root.background ?? fallback.background ?? uniformBackground(collected),
    ansi16,
  };

  const parsedLines: ParsedLine[] = collected.map((runs) => ({
    spans: runs.length > 0 ? runs.map((run) => toSpan(run, defaults)) : [{ text: "", marks: {} }],
  }));

  // After the relining, which needs the spans to still say exactly what the
  // plain flavour says before it will cut on its offsets.
  const lines = (plain ? relineFromPlainText(parsedLines, plain) : parsedLines).map(trimTrailingPadding);
  while (lines.length > 0 && lines[lines.length - 1]!.spans.every((span) => span.text.trim() === "")) {
    lines.pop();
  }
  if (lines.length === 0) return null;

  const styled = lines.some((line) => line.spans.some((span) => Object.keys(span.marks).length > 0));
  return styled ? lines : null;
}
