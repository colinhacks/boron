import { createEditor, type Descendant } from "slate";
import { describe, expect, it } from "vitest";
import { TERMINAL_APP_2_15, TERMINAL_APP_2_15_RTF } from "../core/clipboard-fixtures.ts";
import { DEFAULT_THEME } from "../core/themes.ts";
import { withTerminal } from "./withTerminal.ts";

/** A clipboard carrying exactly the flavours named, and nothing else. */
function transfer(flavours: Record<string, string>): DataTransfer {
  return { getData: (type: string) => flavours[type] ?? "" } as unknown as DataTransfer;
}

function paste(flavours: Record<string, string>): Descendant[] {
  const editor = withTerminal(createEditor(), () => DEFAULT_THEME.ansi);
  editor.children = [{ type: "line", children: [{ text: "" }] }];
  editor.selection = {
    anchor: { path: [0, 0], offset: 0 },
    focus: { path: [0, 0], offset: 0 },
  };
  editor.insertData(transfer(flavours));
  return editor.children;
}

/** Every leaf in the document, as `[text, marks]`. */
function leaves(children: Descendant[]) {
  return children.flatMap((line) =>
    "children" in line
      ? line.children.map((leaf) => {
          const { text, ...marks } = leaf as { text: string };
          return [text, marks] as const;
        })
      : [],
  );
}

describe("withTerminal paste", () => {
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
