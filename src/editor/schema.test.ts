import { Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { parseAnsi } from "../core/ansi.ts";
import { parsedLinesToDocument, type LineElement } from "../core/document.ts";
import { MODIFIER_KEYS } from "../core/types.ts";
import { fromWire, toWire } from "../wire.ts";
import { documentToNode, nodeToDocument, terminalSchema } from "./schema.ts";

const E = "\u001b";

describe("the schema declares the shape", () => {
  it("has exactly the marks that are one SGR code, plus the two colours", () => {
    expect(Object.keys(terminalSchema.marks).sort()).toEqual([...MODIFIER_KEYS, "fg", "bg"].sort());
  });

  it("cannot express nesting, because there is none to express", () => {
    expect(terminalSchema.nodes.doc!.spec.content).toBe("line+");
    expect(terminalSchema.nodes.line!.spec.content).toBe("text*");
  });

  /**
   * The point of a schema over imperative normalization: an invalid document is
   * not something to repair afterwards, it is something that cannot be built.
   */
  it("refuses a document that is not lines of text", () => {
    expect(() => PMNode.fromJSON(terminalSchema, { type: "paragraph", content: [] })).toThrow();
    expect(() =>
      PMNode.fromJSON(terminalSchema, {
        type: "doc",
        content: [{ type: "line", content: [{ type: "line", content: [] }] }],
      }).check(),
    ).toThrow();
  });

  it("refuses a mark with no escape code behind it", () => {
    const withBogusMark = {
      type: "doc",
      content: [{ type: "line", content: [{ type: "text", text: "x", marks: [{ type: "blink" }] }] }],
    };
    expect(() => PMNode.fromJSON(terminalSchema, withBogusMark)).toThrow(/blink/);
  });

  /**
   * The representability invariant, enforced by the schema rather than beside
   * it. Measured, not assumed: a bare `attrs: { color: {} }` is *not* required —
   * PM fills it with `null` and neither `create`, `checkAttrs` nor `check`
   * objects. The `validate` hook is what holds the line, and it runs inside
   * `fromJSON`, which is the door untrusted JSON comes through.
   */
  it("refuses a colour that has no escape code behind it", () => {
    const withColor = (color: unknown) => ({
      type: "doc",
      content: [
        { type: "line", content: [{ type: "text", text: "x", marks: [{ type: "fg", attrs: { color } }] }] },
      ],
    });
    expect(() => PMNode.fromJSON(terminalSchema, withColor("rebeccapurple"))).toThrow(/escape code/);
    expect(() => PMNode.fromJSON(terminalSchema, withColor("oklch(0.7 0.1 200)"))).toThrow(/escape code/);
    expect(() => PMNode.fromJSON(terminalSchema, withColor("ansi256:256"))).toThrow(/escape code/);
    expect(() => PMNode.fromJSON(terminalSchema, withColor(null))).toThrow(/escape code/);
    // And the ones a terminal really can be told.
    for (const color of ["red", "greenBright", "ansi256:208", "#1e3a8a"]) {
      expect(() => PMNode.fromJSON(terminalSchema, withColor(color))).not.toThrow();
    }
  });

  it("refuses a colour mark with no colour at all", () => {
    const noAttr = {
      type: "doc",
      content: [{ type: "line", content: [{ type: "text", text: "x", marks: [{ type: "fg" }] }] }],
    };
    expect(() => PMNode.fromJSON(terminalSchema, noAttr)).toThrow(/escape code/);
  });

  /** Mark order is the schema's, not the caller's — so one document is one JSON. */
  it("orders marks deterministically however they were applied", () => {
    const a = documentToNode([{ type: "line", children: [{ text: "x", bold: true, fg: "red" }] }]);
    const b = documentToNode([{ type: "line", children: [{ text: "x", fg: "red", bold: true }] }]);
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
  });
});

describe("documentToNode / nodeToDocument", () => {
  const cases: Record<string, LineElement[]> = {
    "plain lines": [
      { type: "line", children: [{ text: "$ ls" }] },
      { type: "line", children: [{ text: "a.txt" }] },
    ],
    "an empty line in the middle": [
      { type: "line", children: [{ text: "a" }] },
      { type: "line", children: [{ text: "" }] },
      { type: "line", children: [{ text: "b" }] },
    ],
    "every modifier and colour form": [
      {
        type: "line",
        children: [
          { text: "a", fg: "greenBright", bg: "ansi256:236" },
          { text: "b", bold: true, dim: true, italic: true, underline: true },
          { text: "c", strikethrough: true, inverse: true, hidden: true },
          { text: "d", fg: "#1e3a8a" },
        ],
      },
    ],
    "trailing spaces": [{ type: "line", children: [{ text: "padded     " }] }],
    "a single empty document": [{ type: "line", children: [{ text: "" }] }],
  };

  for (const [name, document] of Object.entries(cases)) {
    it(`round-trips ${name}`, () => {
      const node = documentToNode(document);
      node.check();
      expect(nodeToDocument(node)).toEqual(document);
    });
  }

  it("always produces at least one line, whatever it is handed", () => {
    expect(nodeToDocument(documentToNode([]))).toEqual([{ type: "line", children: [{ text: "" }] }]);
  });
});

/**
 * The migration's real safety net.
 *
 * Every payload in the frozen corpus is a link that could be in the wild. Taking
 * each one through the *new* editor model and back has to leave it decoding
 * identically — if swapping the editor changed what an existing link renders,
 * that is the exact failure this whole seam was built to prevent.
 */
describe("the frozen wire corpus survives the editor swap", () => {
  const payloads = [
    '{"version":1,"content":"$ ls\\na.txt"}',
    '{"version":1,"content":"\\u001b[1;32mPASS\\u001b[0m ok","theme":"nord","backdrop":"mint"}',
    '{"version":1,"content":"\\u001b[38;5;208m256\\u001b[0m \\u001b[38;2;10;200;30mtrue\\u001b[0m","theme":"dracula","backdrop":"none","frame":{"padding":64,"radius":8,"titleBar":true,"title":"zsh","shadow":50,"columns":40}}',
    '{"version":1,"content":"\\u001b[38;5;9ma\\u001b[0m\\u001b[38;5;16mb\\u001b[0m\\u001b[48;5;255mc\\u001b[0m"}',
    '{"version":1,"content":"padded     "}',
  ];

  for (const [index, payload] of payloads.entries()) {
    it(`payload ${index} decodes the same after a trip through ProseMirror`, () => {
      const direct = fromWire(JSON.parse(payload));
      expect(direct).not.toBeNull();

      const node = documentToNode(direct!.document);
      node.check();
      const viaEditor = { ...direct!, document: nodeToDocument(node) };

      expect(viaEditor).toEqual(direct);
      // And re-encoding from the editor's model produces the same wire content.
      expect(toWire(viaEditor).content).toBe(toWire(direct!).content);
    });
  }

  it("keeps a pasted document identical through the editor model", () => {
    const pasted = parsedLinesToDocument(
      parseAnsi(`${E}[31mred${E}[0m ${E}[42;30m bg ${E}[0m${E}[4munder${E}[0m`),
    );
    const node = documentToNode(pasted);
    node.check();
    expect(nodeToDocument(node)).toEqual(pasted);
  });
});
