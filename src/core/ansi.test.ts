import { describe, expect, it } from "vitest";
import { hasAnsi, parseAnsi, stripAnsi } from "./ansi.ts";

const E = "\u001b";

/** Compact view of a parsed line: `[text, marks]` pairs. */
function shape(input: string) {
  return parseAnsi(input).map((line) => line.spans.map((span) => [span.text, span.marks] as const));
}

describe("parseAnsi", () => {
  it("returns one unstyled span for plain text", () => {
    expect(shape("hello world")).toEqual([[["hello world", {}]]]);
  });

  it("splits on newlines and normalizes CRLF", () => {
    expect(stripAnsi("a\r\nb\nc")).toBe("a\nb\nc");
  });

  it("names the standard foreground colors", () => {
    expect(shape(`${E}[31mred${E}[0m plain`)).toEqual([
      [
        ["red", { fg: "red" }],
        [" plain", {}],
      ],
    ]);
  });

  it("names the bright foreground colors", () => {
    expect(shape(`${E}[92mbright`)).toEqual([[["bright", { fg: "greenBright" }]]]);
  });

  it("reads background colors", () => {
    expect(shape(`${E}[44mblue bg`)).toEqual([[["blue bg", { bg: "blue" }]]]);
  });

  it("accumulates modifiers and clears them individually", () => {
    expect(shape(`${E}[1m${E}[4mboth${E}[24mbold`)).toEqual([
      [
        ["both", { bold: true, underline: true }],
        ["bold", { bold: true }],
      ],
    ]);
  });

  it("resets everything on SGR 0 and on a bare CSI m", () => {
    expect(shape(`${E}[1;31ma${E}[0mb`)).toEqual([
      [
        ["a", { bold: true, fg: "red" }],
        ["b", {}],
      ],
    ]);
    expect(shape(`${E}[1;31ma${E}[mb`)).toEqual([
      [
        ["a", { bold: true, fg: "red" }],
        ["b", {}],
      ],
    ]);
  });

  it("keeps 256-color indices below 16 as names and the rest as indices", () => {
    expect(shape(`${E}[38;5;9ma`)).toEqual([[["a", { fg: "redBright" }]]]);
    expect(shape(`${E}[38;5;208mb`)).toEqual([[["b", { fg: "ansi256:208" }]]]);
    expect(shape(`${E}[48;5;236mc`)).toEqual([[["c", { bg: "ansi256:236" }]]]);
  });

  it("reads truecolor in both the semicolon and colon forms", () => {
    expect(shape(`${E}[38;2;255;136;0ma`)).toEqual([[["a", { fg: "#ff8800" }]]]);
    expect(shape(`${E}[38:2::255:136:0mb`)).toEqual([[["b", { fg: "#ff8800" }]]]);
    expect(shape(`${E}[38:5:208mc`)).toEqual([[["c", { fg: "ansi256:208" }]]]);
  });

  it("ignores cursor movement and other non-SGR sequences", () => {
    expect(stripAnsi(`${E}[2J${E}[H${E}[1;1Hhello`)).toBe("hello");
  });

  it("unwraps OSC 8 hyperlinks, keeping the label", () => {
    expect(stripAnsi(`${E}]8;;https://example.com${E}\\click${E}]8;;${E}\\`)).toBe("click");
  });

  it("collapses a progress bar to its final frame", () => {
    expect(stripAnsi("10%\r55%\r100% done")).toBe("100% done");
  });

  it("honours erase-to-end-of-line after a carriage return", () => {
    expect(stripAnsi(`building...\r${E}[Kdone`)).toBe("done");
  });

  it("expands tabs to eight-column stops", () => {
    expect(stripAnsi("a\tb")).toBe("a       b");
    expect(stripAnsi("abcdefgh\tx")).toBe("abcdefgh        x");
  });

  it("applies backspace as a deletion", () => {
    expect(stripAnsi("ab\bc")).toBe("ac");
  });

  it("keeps a surrogate pair in one cell", () => {
    expect(stripAnsi("✓ 🎉 done")).toBe("✓ 🎉 done");
  });

  it("drops trailing plain spaces but keeps ones carrying a background", () => {
    expect(shape("text   ")).toEqual([[["text", {}]]]);
    expect(shape(`${E}[41mtext   `)).toEqual([[["text   ", { bg: "red" }]]]);
  });

  it("survives an escape sequence truncated at the end of input", () => {
    expect(stripAnsi(`done${E}[3`)).toBe("done");
  });
});

describe("hasAnsi", () => {
  it("detects SGR sequences only", () => {
    expect(hasAnsi(`${E}[31mred`)).toBe(true);
    expect(hasAnsi("$ npm install")).toBe(false);
    expect(hasAnsi(`${E}[2J`)).toBe(false);
  });
});
