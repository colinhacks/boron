import { Element, Node, Transforms, type Editor } from "slate";
import { hasAnsi, parseAnsi, type ParsedLine } from "../core/ansi.ts";
import { parsedLinesToDocument, sanitizeDocument } from "../core/document.ts";
import { parseHtmlClipboard } from "../core/html-paste.ts";
import { parseRtfClipboard } from "../core/rtf-paste.ts";

function insertParsed(editor: Editor, lines: readonly ParsedLine[]): void {
  const fragment = parsedLinesToDocument(lines);
  Transforms.insertFragment(editor, fragment);
}

const FRAGMENT_ATTRIBUTE = "data-slate-fragment";

/**
 * The Slate fragment on the clipboard, decoded, or `null` when there isn't one.
 *
 * Looks in the same two places slate-react does: its own MIME type first, then
 * the attribute it smuggles through the HTML flavour for the browsers that drop
 * custom types.
 */
function slateFragment(data: DataTransfer, html: string): unknown {
  let encoded = data.getData("application/x-slate-fragment");
  if (!encoded && html.includes(FRAGMENT_ATTRIBUTE)) {
    encoded = new RegExp(`${FRAGMENT_ATTRIBUTE}="(.+?)"`).exec(html)?.[1] ?? "";
  }
  if (!encoded) return null;
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)));
  } catch {
    return null;
  }
}

/**
 * Teaches the editor to paste like a terminal.
 *
 * Priority is deliberate: raw ANSI in `text/plain` beats rich text, because SGR
 * codes name their colors (`green`) while HTML has already resolved them to one
 * terminal's hex. Only when neither carries styling do we fall through to plain
 * text and let the `$`-prompt heuristic do the work.
 *
 * `text/html` is tried before `text/rtf` because it is the flavour every
 * terminal that writes rich text at all will offer, and on macOS the two say the
 * same thing — the HTML is made out of the RTF. RTF is what is left when nothing
 * made that conversion for us, which off macOS is nobody.
 */
export function withTerminal(editor: Editor, ansi16: () => readonly string[]): Editor {
  const { insertData, normalizeNode } = editor;

  editor.insertData = (data: DataTransfer) => {
    const html = data.getData("text/html");
    const text = data.getData("text/plain");

    // A copy from Boron itself round-trips through Slate's own fragment format.
    //
    // Not handed to Slate as-is, though. Its `insertData` base64-decodes the
    // payload and calls `insertFragment` on whatever JSON comes out, with no
    // validation — and any page can put that attribute on the clipboard. So the
    // fragment goes through the same sanitizer a share link does: a copy from
    // Boron survives it unchanged, and a leaf carrying something no escape code
    // can express does not.
    const fragment = sanitizeDocument(slateFragment(data, html));
    if (fragment) {
      Transforms.insertFragment(editor, fragment);
      return;
    }

    if (text && hasAnsi(text)) {
      insertParsed(editor, parseAnsi(text));
      return;
    }

    if (html) {
      // The plain flavour rides along because the same copy states its rows
      // twice and only one of the two survives a clipboard intact — see
      // `relineFromPlainText`. It decides nothing about styling.
      const parsed = parseHtmlClipboard(html, ansi16(), text);
      if (parsed) {
        insertParsed(editor, parsed);
        return;
      }
    }

    const rtf = data.getData("text/rtf");
    if (rtf) {
      const parsed = parseRtfClipboard(rtf, ansi16());
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
