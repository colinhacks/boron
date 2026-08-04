import { Element, Node, Transforms, type Editor } from "slate";
import { hasAnsi, parseAnsi, type ParsedLine } from "../core/ansi.ts";
import { parsedLinesToDocument } from "../core/document.ts";
import { parseHtmlClipboard } from "../core/html-paste.ts";

function insertParsed(editor: Editor, lines: readonly ParsedLine[]): void {
  const fragment = parsedLinesToDocument(lines);
  Transforms.insertFragment(editor, fragment);
}

/**
 * Teaches the editor to paste like a terminal.
 *
 * Priority is deliberate: raw ANSI in `text/plain` beats rich text, because SGR
 * codes name their colors (`green`) while HTML has already resolved them to one
 * terminal's hex. Only when neither carries styling do we fall through to plain
 * text and let the `$`-prompt heuristic do the work.
 */
export function withTerminal(editor: Editor, ansi16: () => readonly string[]): Editor {
  const { insertData, normalizeNode } = editor;

  editor.insertData = (data: DataTransfer) => {
    const html = data.getData("text/html");
    const text = data.getData("text/plain");

    // A copy from Boron itself round-trips through Slate's own fragment format.
    if (data.getData("application/x-slate-fragment") || html.includes("data-slate-fragment")) {
      insertData(data);
      return;
    }

    if (text && hasAnsi(text)) {
      insertParsed(editor, parseAnsi(text));
      return;
    }

    if (html) {
      const parsed = parseHtmlClipboard(html, ansi16());
      if (parsed) {
        insertParsed(editor, parsed);
        return;
      }
    }

    if (text) {
      // Still goes through the parser: it normalizes CRLF, tabs and stray
      // control characters that would otherwise land in the document.
      insertParsed(editor, parseAnsi(text));
      return;
    }

    insertData(data);
  };

  editor.normalizeNode = (entry, options) => {
    const [node, path] = entry;

    if (path.length === 0) {
      if (editor.children.length === 0) {
        Transforms.insertNodes(editor, { type: "line", children: [{ text: "" }] }, { at: [0] });
        return;
      }
      for (const [child, childPath] of Node.children(editor, path)) {
        if (!Element.isElement(child)) {
          Transforms.wrapNodes(editor, { type: "line", children: [] }, { at: childPath });
          return;
        }
      }
    }

    if (Element.isElement(node) && node.type !== "line") {
      Transforms.setNodes(editor, { type: "line" }, { at: path });
      return;
    }

    normalizeNode(entry, options);
  };

  return editor;
}
