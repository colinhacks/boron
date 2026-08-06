import { createEditor } from "slate";
import { describe, expect, it } from "vitest";
import { documentToRenderLines, type LineElement } from "../core/document.ts";
import { wrapRenderLines } from "../core/wrap.ts";
import {
  boxFragment,
  boxMarks,
  boxRanges,
  boxSpans,
  boxText,
  cellAt,
  clearBoxFormatting,
  deleteBox,
  isEmptyBox,
  normalizeBox,
  setBoxColor,
  toggleBoxModifier,
  visualRows,
  type BoxSelection,
  type Grid,
} from "./box.ts";
import { withTerminal } from "./withTerminal.ts";

/** A document from plain strings — one unstyled run per line. */
function doc(...texts: string[]): LineElement[] {
  return texts.map((text) => ({ type: "line", children: [{ text }] }));
}

function box(topRow: number, bottomRow: number, startColumn: number, endColumn: number): BoxSelection {
  return { topRow, bottomRow, startColumn, endColumn };
}

function editorWith(lines: LineElement[]) {
  const editor = withTerminal(createEditor(), () => []);
  editor.children = lines;
  return editor;
}

/** The document as `[text, marks]` per leaf, per line. */
function leaves(lines: readonly LineElement[]) {
  return lines.map((line) =>
    line.children.map((leaf) => {
      const { text, ...marks } = leaf;
      return [text, marks] as const;
    }),
  );
}

describe("visualRows", () => {
  /*
   * The load-bearing one. The box is drawn in visual rows and the export draws
   * its own; if the two disagree about where a line breaks, a rectangle
   * highlights different characters than the picture shows. They agree without
   * measuring anything because the wrap is an exact character count, and this is
   * what holds them to it.
   */
  it("breaks the same rows wrapRenderLines does", () => {
    const documents = [
      doc("short", "also short"),
      doc("x".repeat(80)),
      doc("x".repeat(81)),
      doc("x".repeat(240), "y"),
      doc("", "after a blank"),
      doc("🎉".repeat(30)),
      doc("é".repeat(19) + "🎉".repeat(5)),
    ];

    for (const lines of documents) {
      for (const columns of [1, 5, 20, 80]) {
        const ours = visualRows(lines, columns);
        const theirs = wrapRenderLines(documentToRenderLines(lines), columns);
        expect(ours.length, `${columns} columns`).toBe(theirs.length);

        ours.forEach((row, index) => {
          const text = lines[row.line]!.children.map((child) => child.text).join("");
          const drawn = theirs[index]!.spans.map((span) => span.text).join("");
          expect(text.slice(row.start, row.end), `row ${index} at ${columns} columns`).toBe(drawn);
        });
      }
    }
  });

  it("gives an empty line one row rather than none", () => {
    expect(visualRows(doc("", ""), 80)).toEqual([
      { line: 0, start: 0, end: 0 },
      { line: 1, start: 0, end: 0 },
    ]);
  });

  it("counts a surrogate pair as one cell but reports UTF-16 offsets", () => {
    // Four astral characters at two columns: two rows, each two code points
    // wide and therefore four UTF-16 units long.
    expect(visualRows(doc("🎉🎉🎉🎉"), 2)).toEqual([
      { line: 0, start: 0, end: 4 },
      { line: 0, start: 4, end: 8 },
    ]);
  });
});

describe("boxSpans", () => {
  it("takes the same columns from every row", () => {
    const lines = doc("alpha bravo", "gamma delta", "kappa lambda");
    expect(boxSpans(lines, 80, box(0, 2, 6, 11))).toEqual([
      { line: 0, start: 6, end: 11 },
      { line: 1, start: 6, end: 11 },
      { line: 2, start: 6, end: 11 },
    ]);
  });

  /*
   * The behaviour that makes column selection feel right rather than broken:
   * a box dragged past the end of a short line leaves it alone instead of
   * clamping onto its last character.
   */
  it("skips rows the box overhangs entirely", () => {
    const lines = doc("a long line here", "short", "another long one");
    expect(boxSpans(lines, 80, box(0, 2, 10, 14))).toEqual([
      { line: 0, start: 10, end: 14 },
      { line: 2, start: 10, end: 14 },
    ]);
  });

  it("takes what is there when the box only partly overhangs", () => {
    expect(boxSpans(doc("abcdefg"), 80, box(0, 0, 4, 20))).toEqual([{ line: 0, start: 4, end: 7 }]);
  });

  it("addresses a wrapped line by its visual rows", () => {
    // One logical line of 24 characters at 10 columns is three rows; a box over
    // rows 1 and 2 must land in the second and third tens, not the first.
    const lines = doc("0123456789abcdefghijklmn");
    expect(boxSpans(lines, 10, box(1, 2, 2, 5))).toEqual([
      { line: 0, start: 12, end: 15 },
      { line: 0, start: 22, end: 24 },
    ]);
  });

  it("is empty when the drag never left its column", () => {
    expect(boxSpans(doc("abc"), 80, box(0, 0, 2, 2))).toEqual([]);
  });
});

describe("boxRanges", () => {
  it("addresses the right child when a line has several runs", () => {
    const lines: LineElement[] = [
      { type: "line", children: [{ text: "red" }, { text: "green", fg: "green" }, { text: "blue" }] },
    ];
    // Columns 4..9 straddle the second and third runs.
    expect(boxRanges(lines, 80, box(0, 0, 4, 9))).toEqual([
      { anchor: { path: [0, 1], offset: 1 }, focus: { path: [0, 2], offset: 1 } },
    ]);
  });
});

describe("boxText", () => {
  it("joins one row per line", () => {
    expect(boxText(doc("alpha bravo", "gamma delta"), 80, box(0, 1, 6, 11))).toBe("bravo\ndelta");
  });

  /*
   * The rectangle's shape has to survive the clipboard. Dropping the blank row
   * would move everything below it up a line, so a column copied out of a table
   * with a gap in it would come back misaligned.
   */
  it("keeps an overhung row as a blank line", () => {
    expect(boxText(doc("aaaaaaaa", "bb", "cccccccc"), 80, box(0, 2, 4, 8))).toBe("aaaa\n\ncccc");
  });
});

describe("boxFragment", () => {
  it("carries each run's marks into the slice", () => {
    const lines: LineElement[] = [
      { type: "line", children: [{ text: "ok " }, { text: "READY", fg: "green", bold: true }] },
    ];
    expect(boxFragment(lines, 80, box(0, 0, 3, 8))).toEqual([
      { type: "line", children: [{ text: "READY", fg: "green", bold: true }] },
    ]);
  });

  it("gives an overhung row an empty line rather than dropping it", () => {
    expect(boxFragment(doc("aaaa", "b"), 80, box(0, 1, 2, 4))).toEqual([
      { type: "line", children: [{ text: "aa" }] },
      { type: "line", children: [{ text: "" }] },
    ]);
  });
});

describe("cellAt", () => {
  const grid: Grid = {
    left: 100,
    top: 50,
    charWidth: 10,
    lineHeight: 20,
    columns: 80,
    rowCount: 5,
  };

  it("rounds the column to the nearer boundary and floors the row", () => {
    // You drag a box by its edges but over whole rows, so the two round differently.
    expect(cellAt(grid, 100, 50)).toEqual({ row: 0, column: 0 });
    expect(cellAt(grid, 124, 69)).toEqual({ row: 0, column: 2 });
    expect(cellAt(grid, 126, 70)).toEqual({ row: 1, column: 3 });
  });

  it("clamps to the grid rather than running off it", () => {
    expect(cellAt(grid, -500, -500)).toEqual({ row: 0, column: 0 });
    expect(cellAt(grid, 5000, 5000)).toEqual({ row: 4, column: 80 });
  });
});

describe("normalizeBox", () => {
  it("puts a drag that ran up and to the left the right way round", () => {
    expect(normalizeBox(box(7, 2, 30, 10))).toEqual(box(2, 7, 10, 30));
  });

  it("calls a zero-width box empty however it is ordered", () => {
    expect(isEmptyBox(normalizeBox(box(0, 3, 9, 9)))).toBe(true);
    expect(isEmptyBox(normalizeBox(box(0, 3, 9, 10)))).toBe(false);
  });
});

describe("commands over a box", () => {
  it("colors the same columns on every row and nothing either side", () => {
    const lines = doc("alpha bravo", "gamma delta");
    const editor = editorWith(lines);
    const target = box(0, 1, 6, 11);
    setBoxColor(editor, boxRanges(lines, 80, target), "fg", "green");

    expect(leaves(editor.children as LineElement[])).toEqual([
      [["alpha ", {}], ["bravo", { fg: "green" }]],
      [["gamma ", {}], ["delta", { fg: "green" }]],
    ]);
  });

  it("marks the same columns of a plain multi-line box", () => {
    const lines = doc("one two three", "four five six", "seven eight ni");
    const editor = editorWith(lines);
    toggleBoxModifier(editor, boxRanges(lines, 80, box(0, 2, 4, 8)), "bold");

    expect((editor.children as LineElement[]).map((line) => leaves([line])[0])).toEqual([
      [["one ", {}], ["two ", { bold: true }], ["three", {}]],
      [["four", {}], [" fiv", { bold: true }], ["e six", {}]],
      [["seve", {}], ["n ei", { bold: true }], ["ght ni", {}]],
    ]);
  });

  /*
   * Two rows of the same *logical* line — which is what a wrapped line is — are
   * the case that forces the bottom-up pass. Marking part of a line splits its
   * text nodes and renumbers its children, so a range held against a later
   * offset on that same line is stale the moment an earlier one is applied.
   * Rows on distinct lines never collide, so this is the only shape that catches
   * a top-down loop: flip the direction in `overBox` and the second row lands in
   * the wrong place.
   */
  it("marks two visual rows of one wrapped line without the first invalidating the second", () => {
    // 30 characters at 10 columns: three rows of one logical line.
    const lines = doc("0123456789abcdefghijABCDEFGHIJ");
    const editor = editorWith(lines);
    setBoxColor(editor, boxRanges(lines, 10, box(0, 2, 2, 5)), "fg", "red");

    expect(leaves(editor.children as LineElement[])).toEqual([
      [
        ["01", {}],
        ["234", { fg: "red" }],
        ["56789ab", {}],
        ["cde", { fg: "red" }],
        ["fghijAB", {}],
        ["CDE", { fg: "red" }],
        ["FGHIJ", {}],
      ],
    ]);
  });

  /**
   * The read side of "leaves a short line untouched". Applying skips a row the
   * box overhangs, because a collapsed range has nothing to set — but reading
   * used to walk into it anyway and fold that row's own marks into the
   * intersection. The toolbar then showed nothing selected for a change it had
   * just made, which reads as the click having failed.
   */
  it("ignores a row the box only overhangs when reporting marks", () => {
    const lines = doc("a long line", "hi", "another one");
    const editor = editorWith(lines);
    const ranges = boxRanges(lines, 80, box(0, 2, 7, 11));
    setBoxColor(editor, ranges, "fg", "red");

    const after = boxRanges(editor.children as LineElement[], 80, box(0, 2, 7, 11));
    expect(boxMarks(editor, after)).toEqual({ fg: "red" });
  });

  it("still intersects across the rows the box actually covers", () => {
    const lines = doc("aaaaaaaaaaa", "bbbbbbbbbbb");
    const editor = editorWith(lines);
    const ranges = boxRanges(lines, 80, box(0, 1, 2, 5));
    setBoxColor(editor, ranges, "fg", "red");
    // Only the first row gets bold, so the two rows no longer agree on it.
    toggleBoxModifier(editor, boxRanges(editor.children as LineElement[], 80, box(0, 0, 2, 5)), "bold");

    const after = boxRanges(editor.children as LineElement[], 80, box(0, 1, 2, 5));
    expect(boxMarks(editor, after)).toEqual({ fg: "red" });
  });

  it("reports nothing for a box that covers no text at all", () => {
    const lines = doc("hi", "yo");
    const editor = editorWith(lines);
    expect(boxMarks(editor, boxRanges(lines, 80, box(0, 1, 20, 24)))).toEqual({});
  });

  it("leaves a short line untouched when the box overhangs it", () => {
    const lines = doc("a long line", "hi", "another one");
    const editor = editorWith(lines);
    setBoxColor(editor, boxRanges(lines, 80, box(0, 2, 7, 11)), "fg", "red");

    expect(leaves(editor.children as LineElement[])[1]).toEqual([["hi", {}]]);
  });

  it("toggles a modifier off when every cell already carries it", () => {
    const lines: LineElement[] = [
      { type: "line", children: [{ text: "abc", bold: true }] },
      { type: "line", children: [{ text: "def", bold: true }] },
    ];
    const editor = editorWith(lines);
    toggleBoxModifier(editor, boxRanges(lines, 80, box(0, 1, 0, 3)), "bold");

    expect(leaves(editor.children as LineElement[])).toEqual([[["abc", {}]], [["def", {}]]]);
  });

  it("clears every mark in the box and none outside it", () => {
    const lines: LineElement[] = [
      { type: "line", children: [{ text: "keepdrop", fg: "red", bold: true }] },
    ];
    const editor = editorWith(lines);
    clearBoxFormatting(editor, boxRanges(lines, 80, box(0, 0, 4, 8)));

    expect(leaves(editor.children as LineElement[])).toEqual([
      [["keep", { fg: "red", bold: true }], ["drop", {}]],
    ]);
  });

  it("cuts the box out and closes the gap on each row", () => {
    const lines = doc("aaaXXXbbb", "cccXXXddd");
    const editor = editorWith(lines);
    deleteBox(editor, boxRanges(lines, 80, box(0, 1, 3, 6)));

    expect((editor.children as LineElement[]).map((line) =>
      line.children.map((child) => child.text).join(""),
    )).toEqual(["aaabbb", "cccddd"]);
  });
});
