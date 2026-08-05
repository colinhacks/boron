import { describe, expect, it } from "vitest";
import type { RenderLine, RenderSpan } from "./types.ts";
import { wrapRenderLines } from "./wrap.ts";

const span = (text: string, overrides: Partial<RenderSpan> = {}): RenderSpan => ({
  text,
  marks: {},
  role: "plain",
  ...overrides,
});

const line = (...spans: RenderSpan[]): RenderLine => ({ spans });

/** What each row reads as, which is what the picture shows. */
const rowText = (lines: readonly RenderLine[]): string[] =>
  lines.map((row) => row.spans.map((s) => s.text).join(""));

describe("wrapRenderLines", () => {
  it("leaves a line that fits alone, as the same object", () => {
    const short = line(span("hello"));
    expect(wrapRenderLines([short], 80)[0]).toBe(short);
  });

  it("cuts at the column, not at the last word before it", () => {
    expect(rowText(wrapRenderLines([line(span("the quick brown fox"))], 8))).toEqual([
      "the quic",
      "k brown ",
      "fox",
    ]);
  });

  it("spends a cell on a space that lands on the boundary", () => {
    // A terminal has nowhere to hang it, so the space occupies the last column
    // and the next row starts at the following character. `break-spaces` in the
    // editor is what makes the browser agree.
    expect(rowText(wrapRenderLines([line(span("aaaaaaa bbbb"))], 8))).toEqual(["aaaaaaa ", "bbbb"]);
  });

  it("ends a line that fills the last column without an empty row after it", () => {
    expect(rowText(wrapRenderLines([line(span("aaaaaaaaaaaaaaaa"))], 8))).toEqual([
      "aaaaaaaa",
      "aaaaaaaa",
    ]);
  });

  it("keeps every row of a wrapped line, however long", () => {
    const rows = wrapRenderLines([line(span("x".repeat(500)))], 80);
    expect(rows).toHaveLength(7);
    expect(rowText(rows).at(-1)).toBe("x".repeat(500 - 6 * 80));
  });

  it("carries the marks and the role onto the continuation rows", () => {
    const rows = wrapRenderLines(
      [line(span("$ ", { role: "prompt", marks: { dim: true } }), span("a".repeat(20), { role: "command" }))],
      8,
    );
    expect(rows.map((row) => row.spans.map((s) => [s.text, s.role]))).toEqual([
      [
        ["$ ", "prompt"],
        ["aaaaaa", "command"],
      ],
      [["aaaaaaaa", "command"]],
      [["aaaaaa", "command"]],
    ]);
    expect(rows[0]!.spans[0]!.marks).toEqual({ dim: true });
  });

  it("breaks between spans without splitting one that lands on the boundary", () => {
    const rows = wrapRenderLines([line(span("aaaaaaaa"), span("bbbb"))], 8);
    expect(rowText(rows)).toEqual(["aaaaaaaa", "bbbb"]);
    expect(rows[0]!.spans).toHaveLength(1);
  });

  it("keeps a surrogate pair in one cell rather than cutting it in half", () => {
    // Four astral characters, eight UTF-16 units: the naive count would split
    // the second one and produce a lone surrogate.
    const rows = wrapRenderLines([line(span("😀😀😀😀"))], 3);
    expect(rowText(rows)).toEqual(["😀😀😀", "😀"]);
  });

  it("leaves an empty line as one empty row", () => {
    expect(wrapRenderLines([line(span(""))], 8)).toEqual([line(span(""))]);
  });

  it("never wraps to nothing, whatever the column count says", () => {
    expect(rowText(wrapRenderLines([line(span("abc"))], 0))).toEqual(["a", "b", "c"]);
    expect(rowText(wrapRenderLines([line(span("abc"))], -5))).toEqual(["a", "b", "c"]);
  });

  it("wraps each line independently", () => {
    expect(rowText(wrapRenderLines([line(span("aaaaaaaaaa")), line(span("b"))], 4))).toEqual([
      "aaaa",
      "aaaa",
      "aa",
      "b",
    ]);
  });
});
