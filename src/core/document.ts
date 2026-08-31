import { toPrintableCells, type ParsedLine } from "./ansi.ts";
import { classifyDocument, hasCommands } from "./prompt.ts";
import { MODIFIER_KEYS, isColor, type Marks, type RenderLine, type RenderSpan, type SpanRole } from "./types.ts";

export type StyledText = Marks & { text: string };

export interface LineElement {
  type: "line";
  children: StyledText[];
}

export type TerminalDocument = LineElement[];

export function lineText(line: LineElement): string {
  return line.children.map((child) => child.text).join("");
}

export function emptyDocument(): TerminalDocument {
  return [{ type: "line", children: [{ text: "" }] }];
}

/**
 * A line from styled runs, with every run put through `toPrintableCells`.
 *
 * Every document in the app is assembled here, and that is the whole point of
 * the function: it is the one place a leaf's text can be checked, so nothing a
 * terminal cell cannot hold reaches a document by *any* door — a rich-text
 * paste, a crafted clipboard slice, or a `localStorage` entry written by an
 * older build.
 *
 * A tab is the one that actually bit. `parseAnsi` expands one to the next stop,
 * but the RTF and HTML paste parsers hand back their text directly, so a copy
 * out of Terminal.app could put a raw tab in the document — where the preview
 * drew it as a browser tab advance and a share link, which states the document
 * as ANSI, brought it back as spaces. Twenty-nine cells became thirty-two, and
 * the reader's picture was wider than the sender's.
 */
export function lineOf(leaves: readonly StyledText[]): LineElement {
  const children: StyledText[] = [];
  let column = 0;
  for (const leaf of leaves) {
    const cells = toPrintableCells(leaf.text, column);
    column = cells.column;
    children.push({ ...leaf, text: cells.text });
  }
  // Neither Slate nor ProseMirror will accept an element with no children.
  return { type: "line", children: children.length > 0 ? children : [{ text: "" }] };
}

/**
 * Flatten the Slate document into styled runs tagged with their `$`-prompt
 * role. Runs are split at the prompt boundary so a single leaf spanning
 * `$ npm install` yields a dim `$ ` and a bright `npm install`.
 */
export function documentToRenderLines(doc: readonly LineElement[]): RenderLine[] {
  const classifications = classifyDocument(doc.map(lineText));
  const commandsPresent = hasCommands(classifications);

  return doc.map((line, index) => {
    const classification = classifications[index]!;
    const roleAt = (offset: number): SpanRole => {
      if (classification.kind === "command") {
        return offset < classification.commandStart ? "prompt" : "command";
      }
      return commandsPresent ? "output" : "plain";
    };

    const spans: RenderSpan[] = [];
    let offset = 0;

    for (const child of line.children) {
      const { text, ...marks } = child;
      if (text.length === 0) {
        spans.push({ text: "", marks, role: roleAt(offset) });
        continue;
      }
      let start = 0;
      while (start < text.length) {
        const role = roleAt(offset + start);
        const boundary = classification.commandStart - offset;
        const end = role === "prompt" && boundary < text.length ? boundary : text.length;
        spans.push({ text: text.slice(start, end), marks, role });
        start = end;
      }
      offset += text.length;
    }

    if (spans.length === 0) spans.push({ text: "", marks: {}, role: roleAt(0) });
    return { spans };
  });
}

/**
 * The marks on one leaf, keeping only what a terminal could be told.
 *
 * Everything Boron draws has to be expressible as an escape sequence, and the
 * `Color` type says so — but a type says nothing where the bytes came off a URL
 * or a clipboard somebody else wrote. A `fg` of `rebeccapurple` would satisfy
 * the browser, paint in the editor, and then serialize to nothing at all.
 * Anything that is not a real SGR mark is dropped here instead.
 */
function sanitizeMarks(leaf: Record<string, unknown>): Marks {
  const marks: Marks = {};
  if (isColor(leaf.fg)) marks.fg = leaf.fg;
  if (isColor(leaf.bg)) marks.bg = leaf.bg;
  for (const key of MODIFIER_KEYS) {
    if (leaf[key] === true) marks[key] = true;
  }
  return marks;
}

/**
 * How many lines an untrusted document may carry. A share link is written by
 * whoever sends it, and the block does not scroll or virtualize: every line is
 * a real DOM node in the editor and a real row in the export. Without a ceiling
 * a few hundred bytes of compressed payload expand into a document that hangs
 * the tab — and it is persisted on arrival, so the next load hangs it again.
 */
export const MAX_LINES = 5000;

/**
 * A Slate document, rebuilt leaf by leaf, or `null` when the shape isn't one.
 * Rebuilt rather than waved through: the copy is what guarantees every mark on
 * it is one the exporters can write.
 */
export function sanitizeDocument(input: unknown): TerminalDocument | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_LINES) return null;

  const lines: LineElement[] = [];
  for (const line of input as unknown[]) {
    if (typeof line !== "object" || line === null) return null;
    const { type, children } = line as { type?: unknown; children?: unknown };
    if (type !== "line" || !Array.isArray(children)) return null;

    const leaves: StyledText[] = [];
    for (const child of children as unknown[]) {
      if (typeof child !== "object" || child === null) return null;
      const leaf = child as Record<string, unknown>;
      if (typeof leaf.text !== "string") return null;
      leaves.push({ text: leaf.text, ...sanitizeMarks(leaf) });
    }

    lines.push(lineOf(leaves));
  }
  return lines;
}

/** Build a Slate document from parsed terminal lines. */
export function parsedLinesToDocument(lines: readonly ParsedLine[]): TerminalDocument {
  const doc = lines.map((line) =>
    lineOf(
      line.spans
        .filter((span, index) => span.text.length > 0 || index === 0)
        .map((span): StyledText => ({ text: span.text, ...span.marks })),
    ),
  );
  return doc.length > 0 ? doc : emptyDocument();
}
