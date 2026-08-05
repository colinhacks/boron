import { Fragment, Slice } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { hasAnsi, parseAnsi, type ParsedLine } from "../core/ansi.ts";
import { parsedLinesToDocument } from "../core/document.ts";
import { parseHtmlClipboard } from "../core/html-paste.ts";
import { parseRtfClipboard } from "../core/rtf-paste.ts";
import { documentToNode } from "./schema.ts";

/**
 * ProseMirror stamps its own clipboard HTML with this, and reads it back through
 * `parseDOM` on the schema — which means a Boron-to-Boron copy is validated
 * against the schema on the way in and keeps every mark exactly.
 *
 * Worth checking for explicitly: that HTML would otherwise be intercepted below
 * by the terminal-HTML parser, which would re-derive the styling from rendered
 * colours and quietly lose the difference between `green` and one theme's idea
 * of green.
 */
function isOwnClipboardHtml(html: string): boolean {
  return html.includes("data-pm-slice");
}

/**
 * Paste like a terminal.
 *
 * Priority is deliberate: `text/plain` carrying SGR codes beats rich text,
 * because SGR codes *name* their colours (`green`) while HTML has already
 * resolved them to one terminal's particular hex. `text/html` is tried before
 * `text/rtf` because it is the flavour every terminal that writes rich text at
 * all will offer, and on macOS the two say the same thing — the HTML is made out
 * of the RTF. RTF is what is left when nothing made that conversion for us.
 */
export function parseClipboard(data: DataTransfer, ansi16: readonly string[]): ParsedLine[] | null {
  const html = data.getData("text/html");
  const text = data.getData("text/plain");

  if (text && hasAnsi(text)) return parseAnsi(text);

  if (html) {
    const parsed = parseHtmlClipboard(html, ansi16);
    if (parsed) return parsed;
  }

  const rtf = data.getData("text/rtf");
  if (rtf) {
    const parsed = parseRtfClipboard(rtf, ansi16);
    if (parsed) return parsed;
  }

  // Still through the parser: it normalizes CRLF, tabs and stray control
  // characters that would otherwise land in the document.
  if (text) return parseAnsi(text);
  return null;
}

/** Replace the selection with parsed lines, splicing into the current line. */
function insertParsed(view: EditorView, lines: readonly ParsedLine[]): void {
  const node = documentToNode(parsedLinesToDocument(lines));
  // openStart/openEnd of 1 means the first and last pasted lines merge with the
  // text either side of the cursor rather than arriving as whole new lines.
  const slice = new Slice(Fragment.from(node.content), 1, 1);
  view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
}

export function pastePlugin(ansi16: () => readonly string[]): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!data) return false;
        if (isOwnClipboardHtml(data.getData("text/html"))) return false;

        const lines = parseClipboard(data, ansi16());
        if (!lines) return false;

        event.preventDefault();
        insertParsed(view, lines);
        return true;
      },
    },
  });
}
