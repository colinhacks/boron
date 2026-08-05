import { describe, expect, it } from "vitest";
import type { ParsedLine } from "../core/ansi.ts";
import { parsedLinesToDocument } from "../core/document.ts";
import { documentToNode, nodeToDocument } from "./schema.ts";
import { TERMINAL_APP_2_15, TERMINAL_APP_2_15_RTF } from "../core/clipboard-fixtures.ts";
import { DEFAULT_THEME } from "../core/themes.ts";
import { parseClipboard } from "./paste.ts";

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
