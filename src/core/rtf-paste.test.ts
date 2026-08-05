import { describe, expect, it } from "vitest";
import type { ParsedLine } from "./ansi.ts";
import { TERMINAL_APP_2_15, TERMINAL_APP_2_15_PLAIN, TERMINAL_APP_2_15_RTF } from "./clipboard-fixtures.ts";
import { parseHtmlClipboard } from "./html-paste.ts";
import { parseRtfClipboard } from "./rtf-paste.ts";
import { DEFAULT_THEME } from "./themes.ts";

const ansi16 = DEFAULT_THEME.ansi;

function shape(rtf: string) {
  return parseRtfClipboard(rtf, ansi16)?.map((line) =>
    line.spans.map((span) => [span.text, span.marks] as const),
  );
}

/** A minimal document with a two-entry color table: 1 is red, 2 is green. */
function doc(body: string) {
  return `{\\rtf1\\ansi{\\colortbl;\\red205\\green49\\blue49;\\red13\\green188\\blue121;}${body}}`;
}

describe("parseRtfClipboard", () => {
  it("declines anything that is not RTF", () => {
    expect(parseRtfClipboard("", ansi16)).toBeNull();
    expect(parseRtfClipboard("<div>html</div>", ansi16)).toBeNull();
  });

  it("returns null when there is no styling to preserve", () => {
    expect(parseRtfClipboard(doc("plain text"), ansi16)).toBeNull();
  });

  it("reads a color out of the color table by index", () => {
    expect(shape(doc("\\cf1 red"))).toEqual([[["red", { fg: "red" }]]]);
  });

  it("treats color index 0 as no color, which is what RTF means by auto", () => {
    expect(shape(doc("\\cf1 red\\cf0 plain"))).toEqual([
      [["red", { fg: "red" }], ["plain", {}]],
    ]);
  });

  it("reads bold, italic, underline and strikethrough, and their off switches", () => {
    expect(shape(doc("\\b bold\\b0 \\i italic\\i0 \\ul under\\ulnone \\strike out"))).toEqual([
      [
        ["bold", { bold: true }],
        ["italic", { italic: true }],
        ["under", { underline: true }],
        ["out", { strikethrough: true }],
      ],
    ]);
  });

  it("breaks lines on \\par and on a backslash before a newline", () => {
    // The color outlives the break — \par ends a paragraph, not a run.
    expect(shape(doc("\\cf1 a\\par b"))).toEqual([[["a", { fg: "red" }]], [["b", { fg: "red" }]]]);
    expect(shape(doc("\\cf1 a\\\nb"))).toEqual([[["a", { fg: "red" }]], [["b", { fg: "red" }]]]);
  });

  it("decodes \\'hh escapes through cp1252 rather than as raw bytes", () => {
    // \'97 is an em dash in cp1252, not U+0097.
    expect(shape(doc("\\cf1 a\\'97b"))).toEqual([[["a—b", { fg: "red" }]]]);
  });

  it("decodes \\u escapes, including the negative form RTF uses above 32767", () => {
    expect(shape(doc("\\cf1 \\uc0\\u10140 "))).toEqual([[["➜", { fg: "red" }]]]);
    expect(shape(doc("\\cf1 \\uc0\\u-24576 "))).toEqual([[["ꀀ", { fg: "red" }]]]);
  });

  it("skips the fallback characters that follow a \\u, per \\uc", () => {
    expect(shape(doc("\\cf1 \\uc1\\u10140 ?"))).toEqual([[["➜", { fg: "red" }]]]);
  });

  it("drops a \\* destination whole rather than spilling its contents", () => {
    expect(shape(doc("\\cf1 a{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0}b"))).toEqual([
      [["ab", { fg: "red" }]],
    ]);
  });

  it("drops the font table without treating its names as text", () => {
    const rtf = "{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 Menlo-Bold;}" +
      "{\\colortbl;\\red205\\green49\\blue49;}\\cf1 x}";
    expect(shape(rtf)).toEqual([[["x", { fg: "red" }]]]);
  });

  it("reads escaped braces and backslashes as literal characters", () => {
    expect(shape(doc("\\cf1 a\\{b\\}c\\\\d"))).toEqual([[["a{b}c\\d", { fg: "red" }]]]);
  });

  it("restores styling when a group closes", () => {
    expect(shape(doc("\\cf1 a{\\cf2 b}c"))).toEqual([
      [["a", { fg: "red" }], ["b", { fg: "green" }], ["c", { fg: "red" }]],
    ]);
  });

  it("keeps every row of a real Terminal.app copy, and its text exactly", () => {
    const lines = parseRtfClipboard(TERMINAL_APP_2_15_RTF, ansi16)!;
    expect(lines.map((line) => line.spans.map((span) => span.text).join(""))).toEqual(
      TERMINAL_APP_2_15_PLAIN.replace(/\n+$/, "").split("\n"),
    );
  });

  it("recovers the same colors the HTML flavour carries", () => {
    const lines = parseRtfClipboard(TERMINAL_APP_2_15_RTF, ansi16)!;
    const marksFor = (text: string) =>
      lines.flatMap((line) => line.spans).find((span) => span.text === text)?.marks;

    expect(marksFor("zshy")).toEqual({ fg: "cyan", bold: true });
    expect(marksFor("main")).toEqual({ fg: "red", bold: true });
    expect(marksFor("http://127.0.0.1:4918/")).toEqual({ fg: "cyan" });
  });

  it("treats the profile's own colors as no color at all", () => {
    const lines = parseRtfClipboard(TERMINAL_APP_2_15_RTF, ansi16)!;
    const spans = lines.flatMap((line) => line.spans);
    const marksFor = (text: string) => spans.find((span) => span.text === text)?.marks;

    expect(marksFor("ready in 21s")).toEqual({});
    expect(marksFor("~/Documents/projects/fray")).toEqual({});
    // The terminal background sits behind every run, so it is not a mark.
    expect(spans.every((span) => span.marks.bg === undefined)).toBe(true);
  });

  it("keeps a uniformly colored snippet's color, since it means what it says", () => {
    expect(shape(doc("\\cf1 all of it is red"))).toEqual([
      [["all of it is red", { fg: "red" }]],
    ]);
  });

  it("agrees with the HTML parser on the same copy", () => {
    // The two flavours are the same paste seen on macOS and off it. Whichever
    // one a platform hands us, the document has to come out the same.
    const fromRtf = parseRtfClipboard(TERMINAL_APP_2_15_RTF, ansi16)!;
    const fromHtml = parseHtmlClipboard(TERMINAL_APP_2_15, ansi16)!;

    const text = (lines: ParsedLine[]) =>
      lines.map((line) => line.spans.map((span) => span.text).join(""));
    expect(text(fromRtf)).toEqual(text(fromHtml));

    // Run boundaries differ — Cocoa splits a run at every padding space — so
    // compare the styling character by character instead.
    const perCharacter = (lines: ParsedLine[]) =>
      lines.map((line) => line.spans.flatMap((span) => [...span.text].map(() => span.marks)));
    expect(perCharacter(fromRtf)).toEqual(perCharacter(fromHtml));
  });
});
