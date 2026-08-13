import type { Node as PMNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { marksOf, terminalSchema } from "./schema.ts";
import { lineText, type LineElement, type StyledText } from "../core/document.ts";
import type { Color, Marks, ModifierKey } from "../core/types.ts";

/**
 * A rectangle of cells, in the coordinates you actually dragged over.
 *
 * Rows are *visual* rows rather than logical lines, because a wrapped line
 * occupies several rows on screen and a box drawn across it has to cover the
 * cells under the pointer, not the characters that happen to share a line
 * element. Columns are code-point offsets within a row, which is the unit the
 * wrap is cut in — see `visualRows`.
 *
 * `endColumn` is exclusive, so an empty box and a one-cell box are tellable
 * apart. Both ends are normalized on construction: `topRow <= bottomRow` and
 * `startColumn <= endColumn`, whichever way the drag ran.
 */
export interface BoxSelection {
  topRow: number;
  bottomRow: number;
  startColumn: number;
  endColumn: number;
}

/** One visual row: which line it belongs to, and the slice of it that's on that row. */
export interface VisualRow {
  /** Index of the logical line in the document. */
  line: number;
  /** UTF-16 offsets into the line's text. `end` is exclusive. */
  start: number;
  end: number;
}

/**
 * Where every visual row begins and ends, in document order.
 *
 * This is the editor-side restatement of `wrapRenderLines`, and the two have to
 * agree exactly or the box would highlight different characters than the export
 * draws — a test pins that. Agreement is cheap because the wrap is not measured:
 * a terminal is a fixed number of columns wide and puts the character that
 * doesn't fit on the next row, so row *k* of a line starts at code point
 * *k × columns* and nothing has to be laid out to know it.
 *
 * Code points, not UTF-16 units, for the same reason `wrapRenderLines` uses
 * them: a surrogate pair is one cell in a terminal and must not be cut in half.
 * The offsets that come back out are UTF-16 because that is what a Slate point
 * is addressed in.
 */
export function visualRows(lines: readonly LineElement[], columns: number): VisualRow[] {
  const width = Math.max(1, Math.floor(columns));
  const rows: VisualRow[] = [];

  lines.forEach((line, index) => {
    const text = lineText(line);
    const points = [...text];
    if (points.length === 0) {
      rows.push({ line: index, start: 0, end: 0 });
      return;
    }
    let start = 0;
    for (let taken = 0; taken < points.length; taken += width) {
      const slice = points.slice(taken, taken + width).join("");
      rows.push({ line: index, start, end: start + slice.length });
      start += slice.length;
    }
  });

  return rows;
}

/** Code-point count of a string — how many cells a terminal spends on it. */
export function cellCount(text: string): number {
  let cells = 0;
  for (const _ of text) cells += 1;
  return cells;
}

/**
 * The character grid as it sits on screen, in client coordinates.
 *
 * Everything here is already through the preview's scale transform, because that
 * is what `getBoundingClientRect` reports and what a mouse event carries. The
 * caller measures; this module only does the arithmetic.
 */
export interface Grid {
  /** Client-space top-left of the text itself, inside the terminal's padding. */
  left: number;
  top: number;
  charWidth: number;
  lineHeight: number;
  /** Terminal width. A box can reach the right edge but not past it. */
  columns: number;
  rowCount: number;
}

/**
 * Which cell a pointer is over.
 *
 * The column rounds and the row floors, and the asymmetry is deliberate: you
 * drag a box by its *edges*, so a pointer halfway through a cell should snap to
 * whichever boundary is nearer — but you drag it over *rows*, so a pointer
 * anywhere in a row means that row.
 */
export function cellAt(grid: Grid, clientX: number, clientY: number): { row: number; column: number } {
  const column = Math.round((clientX - grid.left) / grid.charWidth);
  const row = Math.floor((clientY - grid.top) / grid.lineHeight);
  return {
    row: Math.max(0, Math.min(grid.rowCount - 1, row)),
    column: Math.max(0, Math.min(grid.columns, column)),
  };
}

/**
 * Where a box sits on screen, for anything that has to be positioned over it.
 *
 * The rectangle is the box's full extent, not the cells that turned out to hold
 * text — the highlight only paints where there are characters, but a toolbar
 * pinned to the ragged left edge of a sparse box would jump around as the drag
 * grew.
 */
export function boxRect(grid: Grid, box: BoxSelection): DOMRect {
  const normalized = normalizeBox(box);
  return new DOMRect(
    grid.left + normalized.startColumn * grid.charWidth,
    grid.top + normalized.topRow * grid.lineHeight,
    (normalized.endColumn - normalized.startColumn) * grid.charWidth,
    (normalized.bottomRow - normalized.topRow + 1) * grid.lineHeight,
  );
}

/**
 * The UTF-16 offset `column` code points into `text`, clamped to its end.
 *
 * A box is addressed in cells and the document in UTF-16 units, and the two only
 * coincide until the first astral character. Everything that crosses that border
 * goes through here.
 */
function offsetOfColumn(text: string, column: number): number {
  if (column <= 0) return 0;
  let cells = 0;
  let offset = 0;
  for (const point of text) {
    if (cells === column) return offset;
    cells += 1;
    offset += point.length;
  }
  return offset;
}

/** Turn a UTF-16 offset into a line into the Slate point that addresses it. */
/**
 * The ProseMirror position of a character, counted from the document start.
 *
 * A line node costs one token to enter and one to leave, so every line before
 * this one contributes its text plus two. Slate needed a `[path, offset]` pair
 * and a walk over the line's children to find which run an offset fell in;
 * positions are flat, which is most of why this port shrank rather than grew.
 */
function positionAt(lines: readonly LineElement[], index: number, offset: number): number {
  let position = 1;
  for (let line = 0; line < index; line += 1) {
    position += lineText(lines[line]!).length + 2;
  }
  return position + offset;
}

export function normalizeBox(box: BoxSelection): BoxSelection {
  return {
    topRow: Math.min(box.topRow, box.bottomRow),
    bottomRow: Math.max(box.topRow, box.bottomRow),
    startColumn: Math.min(box.startColumn, box.endColumn),
    endColumn: Math.max(box.startColumn, box.endColumn),
  };
}

/** A box covering no cells at all — a drag that never left its origin column. */
export function isEmptyBox(box: BoxSelection): boolean {
  return box.startColumn >= box.endColumn;
}

/** A run of one line that a box covers, in UTF-16 offsets into that line's text. */
export interface BoxSpan {
  line: number;
  start: number;
  end: number;
}

/**
 * One entry per row of the box, in document order, including the rows it
 * overhangs — those come back with `start === end`.
 *
 * The empty ones matter to anything that has to keep the rectangle's *shape*: a
 * blank row in the middle of a copied column has to stay a blank row, or the
 * text below it moves up. Anything that only cares where to paint or what to
 * restyle uses `boxSpans` instead, which drops them.
 *
 * Offsets are into the whole line rather than points into its children, because
 * both the decorator and the fragment slicer need to re-cut them against one
 * child at a time, and a point has already thrown that away.
 */
function rowSlices(lines: readonly LineElement[], columns: number, box: BoxSelection): BoxSpan[] {
  const normalized = normalizeBox(box);
  if (isEmptyBox(normalized)) return [];

  const rows = visualRows(lines, columns);
  const slices: BoxSpan[] = [];

  for (let index = normalized.topRow; index <= normalized.bottomRow; index += 1) {
    const row = rows[index];
    if (!row) continue;
    const line = lines[row.line];
    if (!line) continue;

    const text = lineText(line).slice(row.start, row.end);
    const cells = cellCount(text);
    const start = row.start + offsetOfColumn(text, Math.min(normalized.startColumn, cells));
    const end = row.start + offsetOfColumn(text, Math.min(normalized.endColumn, cells));
    slices.push({ line: row.line, start, end });
  }

  return slices;
}

/**
 * The runs of text a box actually covers — the empty rows dropped.
 *
 * Rows the box overhangs contribute nothing rather than clamping: dragging a box
 * from column 10 to column 40 down a stack of lines, some of them five
 * characters long, should style the cells that are there and leave the short
 * lines alone. Clamping would instead style their last character on every row,
 * which is the behaviour that makes column selection feel broken.
 */
export function boxSpans(
  lines: readonly LineElement[],
  columns: number,
  box: BoxSelection,
): BoxSpan[] {
  return rowSlices(lines, columns, box).filter((span) => span.start < span.end);
}

/** Those same runs as Slate ranges — what the commands operate on. */
/** One row of the rectangle, as a pair of document positions. */
export interface BoxRange {
  from: number;
  to: number;
}

export function boxRanges(
  lines: readonly LineElement[],
  columns: number,
  box: BoxSelection,
): BoxRange[] {
  return boxSpans(lines, columns, box).flatMap((span) => {
    if (!lines[span.line]) return [];
    return [
      {
        from: positionAt(lines, span.line, span.start),
        to: positionAt(lines, span.line, span.end),
      },
    ];
  });
}

/** The slice of one line between two offsets, with every run's marks carried over. */
function sliceLine(line: LineElement, start: number, end: number): LineElement {
  const children: StyledText[] = [];
  let offset = 0;

  for (const child of line.children) {
    const childStart = offset;
    offset += child.text.length;
    const from = Math.max(start, childStart);
    const to = Math.min(end, offset);
    if (from >= to) continue;
    children.push({ ...child, text: child.text.slice(from - childStart, to - childStart) });
  }

  // Slate will not accept an element with no children, and an overhung row has
  // to survive as a blank line rather than vanish.
  return { type: "line", children: children.length > 0 ? children : [{ text: "" }] };
}

/** The text a box covers, one row per line — the plain flavour on the clipboard. */
export function boxText(lines: readonly LineElement[], columns: number, box: BoxSelection): string {
  return rowSlices(lines, columns, box)
    .map((span) => lineText(lines[span.line]!).slice(span.start, span.end))
    .join("\n");
}

/**
 * The box as a document in its own right, colors intact.
 *
 * This is what makes a column copy worth having in a tool about color: the plain
 * flavour alone would hand back a monochrome column from an editor whose whole
 * point is that the column is green. Pasted back into Boron it is spotted by the
 * `data-pm-slice` stamp and read through the schema's own `parseDOM` rather than
 * the terminal-HTML parser — so the marks arrive exactly as they left, and a
 * colour no escape code could express is dropped by the `fg`/`bg` `getAttrs`
 * instead of being re-derived from a rendered hex. See `paste.ts`.
 */
export function boxFragment(
  lines: readonly LineElement[],
  columns: number,
  box: BoxSelection,
): LineElement[] {
  return rowSlices(lines, columns, box).map((span) => sliceLine(lines[span.line]!, span.start, span.end));
}

const MARK_KEYS = [
  "fg",
  "bg",
  "bold",
  "dim",
  "italic",
  "underline",
  "strikethrough",
  "inverse",
  "hidden",
] as const satisfies readonly (keyof Marks)[];

/**
 * The marks every text node in the box agrees on.
 *
 * Same rule as a linear selection: a mark only counts as active when the whole
 * selection carries it, so a box spanning red and green claims neither.
 */
export function boxMarks(doc: PMNode, ranges: readonly BoxRange[]): Marks {
  let common: Marks | null = null;

  for (const range of ranges) {
    // `slice` cuts at the range's own edges. Walking nodes that merely overlap
    // it would fold in the runs either side, and a colour applied to every
    // covered cell would report as agreed on by none of them.
    doc.slice(range.from, range.to).content.descendants((node) => {
      if (!node.isText || !node.text) return;
      const marks = marksOf(node.marks);
      if (common === null) {
        common = { ...marks };
        return;
      }
      for (const key of MARK_KEYS) {
        if (common[key] !== marks[key]) delete common[key];
      }
    });
  }

  return common ?? {};
}

/**
 * Apply one transaction across every row, back to front.
 *
 * Back to front because each row's positions are measured against the document
 * as it was: editing an earlier row shifts every later one. ProseMirror would
 * let us map positions forward through the transaction instead, but reversing
 * is the same trick Slate needed and it stays obvious.
 */
function overBox(view: EditorView, ranges: readonly BoxRange[], apply: (tr: Transaction, range: BoxRange) => void): void {
  if (ranges.length === 0) return;
  const tr = view.state.tr;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index]!;
    if (range.from !== range.to) apply(tr, range);
  }
  if (tr.docChanged) view.dispatch(tr);
}

export function setBoxColor(
  view: EditorView,
  ranges: readonly BoxRange[],
  key: "fg" | "bg",
  color: Color | null,
): void {
  const type = terminalSchema.marks[key]!;
  overBox(view, ranges, (tr, range) => {
    tr.removeMark(range.from, range.to, type);
    if (color !== null) tr.addMark(range.from, range.to, type.create({ color }));
  });
}

export function toggleBoxModifier(view: EditorView, ranges: readonly BoxRange[], key: ModifierKey): void {
  const type = terminalSchema.marks[key]!;
  const active = boxMarks(view.state.doc, ranges)[key] === true;
  overBox(view, ranges, (tr, range) => {
    if (active) tr.removeMark(range.from, range.to, type);
    else tr.addMark(range.from, range.to, type.create());
  });
}

export function clearBoxFormatting(view: EditorView, ranges: readonly BoxRange[]): void {
  overBox(view, ranges, (tr, range) => {
    for (const key of MARK_KEYS) tr.removeMark(range.from, range.to, terminalSchema.marks[key]!);
  });
}

export function deleteBox(view: EditorView, ranges: readonly BoxRange[]): void {
  overBox(view, ranges, (tr, range) => {
    tr.delete(range.from, range.to);
  });
}
