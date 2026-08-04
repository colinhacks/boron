import { describe, expect, it } from "vitest";
import { parseHtmlClipboard } from "./html-paste.ts";
import { DEFAULT_THEME } from "./themes.ts";

const ansi16 = DEFAULT_THEME.ansi;

function shape(html: string) {
  return parseHtmlClipboard(html, ansi16)?.map((line) =>
    line.spans.map((span) => [span.text, span.marks] as const),
  );
}

describe("parseHtmlClipboard", () => {
  it("returns null for markup with no styling to preserve", () => {
    expect(parseHtmlClipboard("<div>plain text</div>", ansi16)).toBeNull();
    expect(parseHtmlClipboard("", ansi16)).toBeNull();
  });

  it("maps a known terminal palette color back onto its chalk name", () => {
    // #0dbc79 is VS Code's green, even though Boron's own green differs.
    expect(shape('<div><span style="color: #0dbc79">ok</span></div>')).toEqual([[["ok", { fg: "green" }]]]);
  });

  it("keeps an unrecognized color as a literal hex", () => {
    expect(shape('<div><span style="color: #7f3fbf">x</span></div>')).toEqual([[["x", { fg: "#7f3fbf" }]]]);
  });

  it("treats the wrapper's own foreground as unstyled so the prompt heuristic still applies", () => {
    const html =
      '<div style="color: #cccccc; background-color: #1f1f1f; white-space: pre;">' +
      "<div><span style=\"color: #cccccc;\">$ ls</span></div>" +
      '<div><span style="color: #0dbc79;">a.txt</span></div>' +
      "</div>";
    expect(shape(html)).toEqual([[["$ ls", {}]], [["a.txt", { fg: "green" }]]]);
  });

  it("reads bold, italic, underline and strikethrough from tags and styles", () => {
    expect(shape("<div><b>b</b><i>i</i><u>u</u><s>s</s><span style=\"color:#cd3131\">r</span></div>")).toEqual([
      [
        ["b", { bold: true }],
        ["i", { italic: true }],
        ["u", { underline: true }],
        ["s", { strikethrough: true }],
        ["r", { fg: "red" }],
      ],
    ]);
  });

  it("reads a numeric font-weight as bold", () => {
    expect(shape('<div><span style="font-weight: 700; color:#cd3131">x</span></div>')).toEqual([
      [["x", { fg: "red", bold: true }]],
    ]);
  });

  it("reads reduced opacity as dim, which is how several terminals render SGR 2", () => {
    expect(shape('<div><span style="opacity: 0.6; color:#cd3131">x</span></div>')).toEqual([
      [["x", { fg: "red", dim: true }]],
    ]);
  });

  it("breaks lines on <br> and on block elements", () => {
    expect(shape('<span style="color:#cd3131">a</span><br><span style="color:#0dbc79">b</span>')).toEqual([
      [["a", { fg: "red" }]],
      [["b", { fg: "green" }]],
    ]);
  });

  it("preserves runs of spaces inside white-space: pre", () => {
    const html = '<div style="white-space: pre;"><span style="color:#0dbc79">a    b</span></div>';
    expect(shape(html)).toEqual([[["a    b", { fg: "green" }]]]);
  });

  it("normalizes non-breaking spaces used for terminal padding", () => {
    const html = '<div><span style="color:#0dbc79">a&nbsp;&nbsp;b</span></div>';
    expect(shape(html)).toEqual([[["a  b", { fg: "green" }]]]);
  });

  it("drops markup indentation that is only source formatting", () => {
    const html = `<div>
      <span style="color:#0dbc79">ok</span>
    </div>`;
    expect(shape(html)).toEqual([[["ok", { fg: "green" }]]]);
  });

  it("ignores a background that merely repeats the wrapper's own", () => {
    const html =
      '<div style="background-color:#1e1e1e"><span style="background-color:#1e1e1e; color:#cd3131">x</span></div>';
    expect(shape(html)).toEqual([[["x", { fg: "red" }]]]);
  });
});
