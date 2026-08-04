import { describe, expect, it } from "vitest";
import { documentToRenderLines, parsedLinesToDocument, type LineElement } from "./document.ts";
import { parseAnsi } from "./ansi.ts";

const E = "\u001b";

function roles(doc: LineElement[]) {
  return documentToRenderLines(doc).map((line) => line.spans.map((span) => [span.text, span.role] as const));
}

describe("documentToRenderLines", () => {
  it("splits a command line at the prompt boundary", () => {
    const doc: LineElement[] = [{ type: "line", children: [{ text: "$ npm install" }] }];
    expect(roles(doc)).toEqual([
      [
        ["$ ", "prompt"],
        ["npm install", "command"],
      ],
    ]);
  });

  it("splits at the boundary even when it falls inside a styled leaf", () => {
    const doc: LineElement[] = [
      { type: "line", children: [{ text: "colin@mac:~$ ls", fg: "green" }] },
    ];
    expect(roles(doc)).toEqual([
      [
        ["colin@mac:~$ ", "prompt"],
        ["ls", "command"],
      ],
    ]);
  });

  it("dims output only once the document contains a command", () => {
    const plain: LineElement[] = [{ type: "line", children: [{ text: "just a note" }] }];
    expect(roles(plain)).toEqual([[["just a note", "plain"]]]);

    const withCommand: LineElement[] = [
      { type: "line", children: [{ text: "$ ls" }] },
      { type: "line", children: [{ text: "a.txt" }] },
    ];
    expect(roles(withCommand)).toEqual([
      [
        ["$ ", "prompt"],
        ["ls", "command"],
      ],
      [["a.txt", "output"]],
    ]);
  });

  it("carries explicit marks through onto the runs", () => {
    const doc: LineElement[] = [
      { type: "line", children: [{ text: "ok", fg: "green", bold: true }] },
    ];
    const [line] = documentToRenderLines(doc);
    expect(line?.spans[0]?.marks).toEqual({ fg: "green", bold: true });
  });

  it("keeps a run per leaf so adjacent colors stay distinct", () => {
    const doc: LineElement[] = [
      { type: "line", children: [{ text: "✓", fg: "green" }, { text: " built" }] },
    ];
    expect(roles(doc)).toEqual([
      [
        ["✓", "plain"],
        [" built", "plain"],
      ],
    ]);
  });

  it("emits a span for an empty line so it still occupies a row", () => {
    const doc: LineElement[] = [
      { type: "line", children: [{ text: "$ ls" }] },
      { type: "line", children: [{ text: "" }] },
    ];
    expect(documentToRenderLines(doc)).toHaveLength(2);
  });
});

describe("parsedLinesToDocument", () => {
  it("round-trips ANSI into Slate line elements", () => {
    const doc = parsedLinesToDocument(parseAnsi(`${E}[32mok${E}[0m\nplain`));
    expect(doc).toEqual([
      { type: "line", children: [{ text: "ok", fg: "green" }] },
      { type: "line", children: [{ text: "plain" }] },
    ]);
  });

  it("never produces a line without a text child", () => {
    const doc = parsedLinesToDocument(parseAnsi("a\n\nb"));
    expect(doc.every((line) => line.children.length > 0)).toBe(true);
  });
});
