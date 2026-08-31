import { describe, expect, it } from "vitest";
import type { ParsedLine } from "../core/ansi.ts";
import { parsedLinesToDocument } from "../core/document.ts";
import { documentToNode, nodeToDocument } from "./schema.ts";
import { TERMINAL_APP_2_15, TERMINAL_APP_2_15_RTF } from "../core/clipboard-fixtures.ts";
import type { HighlightChoice } from "../core/highlight.ts";
import { DEFAULT_THEME } from "../core/themes.ts";
import { parseClipboard, readClipboard } from "./paste.ts";

/** A clipboard carrying exactly the flavours named, and nothing else. */
function transfer(flavours: Record<string, string>): DataTransfer {
  return { getData: (type: string) => flavours[type] ?? "" } as unknown as DataTransfer;
}

function paste(flavours: Record<string, string>): ParsedLine[] {
  return parseClipboard(transfer(flavours), DEFAULT_THEME.ansi) ?? [];
}

/**
 * Every leaf of the document the paste actually produces, as `[text, marks]`.
 *
 * Through the editor's own model rather than straight off the parse, because
 * that is where adjacent runs carrying identical marks are merged. Whether a
 * particular parser emitted one run or three for the same styled text is not a
 * difference anyone can see, and comparing before the merge would fail on it.
 */
function leaves(lines: ParsedLine[]) {
  return nodeToDocument(documentToNode(parsedLinesToDocument(lines))).flatMap((line) =>
    line.children.map(({ text, ...marks }) => [text, marks] as const),
  );
}

describe("clipboard flavour priority", () => {
  it("keeps the colors when only text/rtf is on the clipboard", () => {
    // The case off macOS: nothing converted the RTF for us, so if we do not
    // parse it the paste arrives bare.
    const marks = leaves(paste({ "text/rtf": TERMINAL_APP_2_15_RTF }));
    expect(marks.find(([text]) => text === "zshy")?.[1]).toEqual({ fg: "cyan", bold: true });
    expect(marks.find(([text]) => text === "main")?.[1]).toEqual({ fg: "red", bold: true });
  });

  it("keeps the colors when only text/html is on the clipboard", () => {
    const marks = leaves(paste({ "text/html": TERMINAL_APP_2_15 }));
    expect(marks.find(([text]) => text === "zshy")?.[1]).toEqual({ fg: "cyan", bold: true });
  });

  it("reaches the same document whichever of the two flavours it is given", () => {
    expect(leaves(paste({ "text/rtf": TERMINAL_APP_2_15_RTF }))).toEqual(
      leaves(paste({ "text/html": TERMINAL_APP_2_15, "text/rtf": TERMINAL_APP_2_15_RTF })),
    );
  });

  it("lets raw ANSI in text/plain outrank both, since it names its colors", () => {
    const marks = leaves(
      paste({ "text/plain": "[32mgreen[0m", "text/rtf": TERMINAL_APP_2_15_RTF }),
    );
    expect(marks).toEqual([["green", { fg: "green" }]]);
  });

  it("falls through to plain text when the rich flavour carries no styling", () => {
    const marks = leaves(paste({ "text/plain": "bare", "text/rtf": "{\\rtf1\\ansi bare}" }));
    expect(marks).toEqual([["bare", {}]]);
  });
});

/* ------------------------------------------------------------- highlight -- */

describe("what a paste does to the syntax control", () => {
  const read = (flavours: Record<string, string>, choice: HighlightChoice = "auto") =>
    readClipboard(transfer(flavours), DEFAULT_THEME.ansi, choice);

  const colorsOf = (lines: ParsedLine[]) =>
    new Set(lines.flatMap((line) => line.spans).map((span) => span.marks.fg).filter(Boolean));

  it("highlights unstyled code and names the language it found", () => {
    const result = read({ "text/plain": 'const parse = (s: string) => s.split("");\nexport default parse;' });
    expect(result?.highlight).toBe("typescript");
    expect(colorsOf(result!.lines).size).toBeGreaterThan(1);
  });

  it("keeps the escape codes and selects Custom (ANSI) when the paste carries them", () => {
    // The colours came with the text and have an author; the highlighter does
    // not get a vote, whatever the code underneath would have scored.
    const result = read({ "text/plain": "\u001b[32mconst\u001b[39m x = 1;" });
    expect(result?.highlight).toBe("ansi");
    expect(colorsOf(result!.lines)).toEqual(new Set(["green"]));
  });

  it("leaves terminal output alone and does not touch the control", () => {
    const result = read({ "text/plain": "$ git status\nOn branch main\nnothing to commit" });
    expect(result?.highlight).toBe("auto");
    expect(colorsOf(result!.lines).size).toBe(0);
  });

  it("honours an explicit language, even for text auto-detect would decline", () => {
    const result = read({ "text/plain": "x = 1" }, "python");
    expect(result?.highlight).toBe("python");
    expect(colorsOf(result!.lines).size).toBeGreaterThan(0);
  });

  it("highlights nothing at all under Custom (ANSI)", () => {
    const result = read({ "text/plain": 'const parse = (s: string) => s.split("");' }, "ansi");
    expect(result?.highlight).toBe("ansi");
    expect(colorsOf(result!.lines).size).toBe(0);
  });

  it("never highlights rich text, which already stated its own colours", () => {
    const result = read({ "text/rtf": TERMINAL_APP_2_15_RTF });
    expect(result?.highlight).toBe("ansi");
  });
});
