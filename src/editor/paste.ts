import { Fragment, Slice } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { hasAnsi, parseAnsi, type ParsedLine } from "../core/ansi.ts";
import { MAX_LINES, parsedLinesToDocument } from "../core/document.ts";
import { autoHighlight, highlightToAnsi, type HighlightChoice } from "../core/highlight.ts";
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
/**
 * The winning flavour's lines, and whether that flavour brought its own colors.
 *
 * The distinction is what the syntax highlighter keys on: text that named its
 * own colors has an author, and a highlighter second-guessing them would throw
 * away the thing Boron exists to keep.
 */
type FlavourRead =
  | { lines: ParsedLine[]; styled: true }
  | { lines: ParsedLine[]; styled: false; text: string };

function readFlavours(data: DataTransfer, ansi16: readonly string[]): FlavourRead | null {
  const html = data.getData("text/html");
  const text = data.getData("text/plain");

  if (text && hasAnsi(text)) return { lines: parseAnsi(text), styled: true };

  if (html) {
    // The plain flavour rides along because the same copy states its rows twice
    // and only one of the two survives a clipboard intact — see
    // `relineFromPlainText`. It decides nothing about styling.
    const parsed = parseHtmlClipboard(html, ansi16, text);
    if (parsed) return { lines: parsed, styled: true };
  }

  const rtf = data.getData("text/rtf");
  if (rtf) {
    const parsed = parseRtfClipboard(rtf, ansi16);
    if (parsed) return { lines: parsed, styled: true };
  }

  // Still through the parser: it normalizes CRLF, tabs and stray control
  // characters that would otherwise land in the document.
  if (text) return { lines: parseAnsi(text), styled: false, text };
  return null;
}

export function parseClipboard(data: DataTransfer, ansi16: readonly string[]): ParsedLine[] | null {
  return readFlavours(data, ansi16)?.lines ?? null;
}

/** The lines to insert, and what the syntax control should read afterwards. */
export interface ClipboardRead {
  lines: ParsedLine[];
  highlight: HighlightChoice;
}

/**
 * A paste, with the syntax question answered.
 *
 * Three outcomes, and which one applies is decided by the text rather than by
 * the reader: a paste carrying escape codes keeps them and selects `ansi`; an
 * unstyled paste under an explicit language is highlighted as that language; an
 * unstyled paste under `auto` is highlighted only if `autoHighlight` recognizes
 * it, and otherwise lands exactly as it arrived with the control untouched.
 */
export function readClipboard(
  data: DataTransfer,
  ansi16: readonly string[],
  choice: HighlightChoice,
): ClipboardRead | null {
  const read = readFlavours(data, ansi16);
  if (!read) return null;
  if (read.styled) return { lines: read.lines, highlight: "ansi" };
  if (choice === "ansi") return { lines: read.lines, highlight: choice };

  if (choice !== "auto") {
    return { lines: parseAnsi(highlightToAnsi(read.text, choice)), highlight: choice };
  }

  const detected = autoHighlight(read.text);
  if (!detected) return { lines: read.lines, highlight: "auto" };
  return { lines: parseAnsi(detected.ansi), highlight: detected.language };
}

/**
 * The parsed lines as a slice, cut to the document ceiling.
 *
 * `sanitizeDocument` refuses a document longer than `MAX_LINES`, and that is the
 * reader on the *load* path — so a paste that sails past it is not merely large,
 * it is a document that will be thrown away whole the next time the app opens.
 * Losing the tail of an enormous paste is the smaller loss.
 */
function sliceFor(lines: readonly ParsedLine[]): Slice {
  const node = documentToNode(parsedLinesToDocument(lines.slice(0, MAX_LINES)));
  // openStart/openEnd of 1 means the first and last pasted lines merge with the
  // text either side of the cursor rather than arriving as whole new lines.
  return new Slice(Fragment.from(node.content), 1, 1);
}

export interface PasteOptions {
  ansi16: () => readonly string[];
  /** What the syntax control reads right now — read at paste time, not captured. */
  highlight: () => HighlightChoice;
  /** Fires when a paste decides the syntax question, so the control can follow. */
  onHighlight: (choice: HighlightChoice) => void;
}

export function pastePlugin({ ansi16, highlight, onHighlight }: PasteOptions): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!data) return false;
        if (isOwnClipboardHtml(data.getData("text/html"))) return false;

        const read = readClipboard(data, ansi16(), highlight());
        if (!read) return false;

        event.preventDefault();
        view.dispatch(view.state.tr.replaceSelection(sliceFor(read.lines)).scrollIntoView());
        onHighlight(read.highlight);
        return true;
      },

      /**
       * A drop is a paste that arrived by hand, and ProseMirror routes it through
       * a different prop — `handlePaste` is never consulted for one. Without this
       * the flavour priority above is skipped and terminal output dragged in from
       * Ghostty or Terminal.app arrives as ProseMirror-parsed markup, which is one
       * line per styled run.
       *
       * A drag that started *inside* the editor is left alone: it carries a
       * schema-validated slice and its own move semantics, and re-deriving it from
       * rendered colours would lose the difference between `green` and one theme's
       * idea of green — the same reason `isOwnClipboardHtml` exists.
       */
      handleDrop(view, event) {
        if (view.dragging) return false;
        const data = event.dataTransfer;
        if (!data) return false;
        if (isOwnClipboardHtml(data.getData("text/html"))) return false;

        const read = readClipboard(data, ansi16(), highlight());
        if (!read) return false;

        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!at) return false;

        event.preventDefault();
        view.dispatch(view.state.tr.replace(at.pos, at.pos, sliceFor(read.lines)).scrollIntoView());
        view.focus();
        onHighlight(read.highlight);
        return true;
      },
    },

    /**
     * The ceiling again, this time as an invariant rather than a cut. Two pastes
     * of three thousand lines each clear `sliceFor` individually and still leave a
     * document `sanitizeDocument` will reject, so the guard has to be on the
     * document rather than on the input.
     */
    filterTransaction(transaction, state) {
      if (!transaction.docChanged) return true;
      return transaction.doc.childCount <= Math.max(MAX_LINES, state.doc.childCount);
    },
  });
}
