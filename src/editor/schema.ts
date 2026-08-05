import { Schema, type Mark, type MarkSpec, type Node as PMNode } from "prosemirror-model";
import type { LineElement, StyledText, TerminalDocument } from "../core/document.ts";
import { isColor, MODIFIER_KEYS, type Marks } from "../core/types.ts";

/**
 * What a Boron document is, declared rather than defended.
 *
 * The editor used to be Slate, which has no schema: validity was imperative code
 * in `normalizeNode` that ran *after* an invalid document had already been built.
 * Here the shape is data. `doc: "line+"` and `line: "text*"` mean a document is
 * lines and a line is text, and ProseMirror will not construct anything else —
 * there is no nesting to forbid because there is no nesting to express.
 *
 * The mark set is generated from `MODIFIER_KEYS` so the two cannot drift. That
 * list is defined as "every modifier that is exactly one SGR code, and nothing
 * else", which makes this schema a restatement of the invariant the whole tool
 * rests on: an unknown mark is not something to sanitize away later, it is
 * something `Node.fromJSON` refuses to build.
 *
 * Marks render as bare semantic spans. Appearance is decided by `resolveStyle`
 * and applied as decorations, because what a run looks like depends on the theme
 * and on the `$`-prompt heuristic — neither of which belongs in the document.
 */
const modifierMarks = Object.fromEntries(
  MODIFIER_KEYS.map((key): [string, MarkSpec] => [
    key,
    {
      toDOM: () => ["span", { class: `sgr-${key}` }, 0],
      parseDOM: [{ tag: `span.sgr-${key}` }],
    },
  ]),
);

/**
 * A colour mark, with the representability rule attached to the attribute.
 *
 * `attrs: { color: {} }` looks like "required" and is not — ProseMirror fills a
 * missing attribute with `null` and neither `create`, `checkAttrs` nor `check`
 * complains. A `validate` hook is what actually holds: it runs inside
 * `Node.fromJSON`, which is the door untrusted JSON comes through, and it
 * rejects both a missing colour and one no escape code could express.
 *
 * So the invariant stops being a sanitizer that runs alongside the schema and
 * becomes part of the schema. `isColor` is the same predicate the rest of the
 * app uses, so there is still exactly one definition of what a colour is.
 */
function colorMark(name: "fg" | "bg"): MarkSpec {
  return {
    attrs: {
      color: {
        validate: (value: unknown) => {
          if (!isColor(value)) {
            throw new RangeError(`${name}: ${JSON.stringify(value)} has no escape code behind it`);
          }
        },
      },
    },
    toDOM: (mark: Mark) => ["span", { class: `sgr-${name}`, "data-color": String(mark.attrs.color) }, 0],
    parseDOM: [
      {
        tag: `span.sgr-${name}`,
        getAttrs: (dom: HTMLElement) => {
          const color = dom.getAttribute("data-color");
          // An unreadable colour drops the mark rather than carrying something
          // no escape code can express.
          return isColor(color) ? { color } : false;
        },
      },
    ],
  };
}

export const terminalSchema = new Schema({
  nodes: {
    doc: { content: "line+" },
    line: {
      content: "text*",
      toDOM: () => ["div", { class: "terminal-line" }, 0],
      parseDOM: [{ tag: "div.terminal-line" }],
    },
    text: {},
  },
  marks: { ...modifierMarks, fg: colorMark("fg"), bg: colorMark("bg") },
});

/* ------------------------------------------------------------ conversion -- */

/**
 * ProseMirror is the editing surface; `TerminalDocument` stays the interchange
 * type everything else speaks. `core/` and `export/` have never referred to an
 * editor and still do not, which is what keeps this swap contained — and what
 * would keep the next one contained too.
 */

function marksFor(leaf: StyledText): Mark[] {
  const marks: Mark[] = [];
  for (const key of MODIFIER_KEYS) {
    if (leaf[key] === true) marks.push(terminalSchema.marks[key]!.create());
  }
  if (leaf.fg !== undefined) marks.push(terminalSchema.marks.fg!.create({ color: leaf.fg }));
  if (leaf.bg !== undefined) marks.push(terminalSchema.marks.bg!.create({ color: leaf.bg }));
  return marks;
}

/** The Boron marks a ProseMirror mark set carries. */
export function marksOf(pmMarks: readonly Mark[]): Marks {
  const marks: Marks = {};
  for (const mark of pmMarks) {
    if (mark.type.name === "fg" || mark.type.name === "bg") {
      const color = mark.attrs.color;
      if (isColor(color)) marks[mark.type.name] = color;
      continue;
    }
    for (const key of MODIFIER_KEYS) {
      if (mark.type.name === key) marks[key] = true;
    }
  }
  return marks;
}

export function documentToNode(document: readonly LineElement[]): PMNode {
  const lines = document.map((line) => {
    // PM has no empty text node, so an empty line is a line with no content.
    // `line: "text*"` allows exactly that.
    const children = line.children
      .filter((leaf) => leaf.text.length > 0)
      .map((leaf) => terminalSchema.text(leaf.text, marksFor(leaf)));
    return terminalSchema.nodes.line!.create(null, children);
  });
  // `doc: "line+"` — a document always has at least one line.
  return terminalSchema.nodes.doc!.create(null, lines.length > 0 ? lines : [terminalSchema.nodes.line!.create()]);
}

export function nodeToDocument(node: PMNode): TerminalDocument {
  const document: LineElement[] = [];
  node.forEach((line) => {
    const children: StyledText[] = [];
    line.forEach((child) => {
      if (child.isText && child.text) children.push({ text: child.text, ...marksOf(child.marks) });
    });
    document.push({ type: "line", children: children.length > 0 ? children : [{ text: "" }] });
  });
  return document.length > 0 ? document : [{ type: "line", children: [{ text: "" }] }];
}
