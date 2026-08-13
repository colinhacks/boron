import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { DOMSerializer } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type Ref } from "react";
import type { LineElement, TerminalDocument } from "../core/document.ts";
import type { Theme } from "../core/themes.ts";
import { FONT_FAMILY } from "../export/fonts.ts";
import { boxFragment, boxText, cellAt, deleteBox } from "./box.ts";
import { useBoxSelection } from "./BoxSelection.tsx";
import { refreshStyles, styleKey, stylePlugin } from "./decorations.ts";
import { pastePlugin } from "./paste.ts";
import { documentToNode, nodeToDocument, terminalSchema } from "./schema.ts";
import { useFormatting } from "./useFormatting.ts";

/** What the app can ask of the editor from outside. */
export interface TerminalHandle {
  /** Swap the whole document out — Reset, or opening someone else's workspace. */
  replaceDocument: (document: TerminalDocument) => void;
  view: () => EditorView | null;
}

export interface TerminalSurfaceProps {
  initialDocument: TerminalDocument;
  /** The live document, for the geometry the box is measured in. */
  lines: readonly LineElement[];
  theme: Theme;
  ansi16: () => readonly string[];
  fontSize: number;
  lineHeight: number;
  halfLeading: number;
  padding: number;
  width: number;
  /** Where a line wraps. Narrower than `width` when a long title widened the block. */
  wrapWidth: number;
  columns: number;
  onChange: (document: TerminalDocument) => void;
  /** Fires on every transaction, so the toolbars can re-read the active marks. */
  onSelectionChange?: () => void;
  handle?: Ref<TerminalHandle>;
}

const clipboardSerializer = DOMSerializer.fromSchema(terminalSchema);

export function TerminalSurface({
  initialDocument,
  lines,
  theme,
  ansi16,
  fontSize,
  lineHeight,
  halfLeading,
  padding,
  width,
  wrapWidth,
  columns,
  onChange,
  onSelectionChange,
  handle,
}: TerminalSurfaceProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const { box, ranges, measureGrid, setBox, clear } = useBoxSelection();
  const formatting = useFormatting();

  // The view is built once and never torn down — recreating it would cost the
  // selection, the undo stack and focus on every render — so everything dynamic
  // is read through this rather than captured in a closure.
  const latest = useRef({ theme, halfLeading, onChange, onSelectionChange, ansi16, lines, columns, box, ranges, measureGrid, setBox, clear, formatting });
  latest.current = { theme, halfLeading, onChange, onSelectionChange, ansi16, lines, columns, box, ranges, measureGrid, setBox, clear, formatting };

  /**
   * Put the caret where the box started and drop the box.
   *
   * A rectangle has no caret, so anything that wants to type needs somewhere to
   * type *to*. Its own first cell is the least surprising answer — it is where
   * the gesture began and where the eye already is.
   */
  const collapseBox = useCallback(() => {
    const view = viewRef.current;
    const first = latest.current.ranges[0];
    latest.current.clear();
    if (!view || !first) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(first.from))));
  }, []);

  /**
   * The rectangle on the clipboard, colours and all.
   *
   * Both flavours go on: plain text for everything else, and ProseMirror's own
   * HTML — stamped so it reads it back through the schema — so pasting a column
   * into Boron keeps the palette. A monochrome column out of a tool about colour
   * would be half a feature.
   */
  const writeBox = useCallback((event: ClipboardEvent): boolean => {
    const { box: current, lines: docLines, columns: cols } = latest.current;
    if (!current || !event.clipboardData) return false;

    event.preventDefault();
    event.clipboardData.setData("text/plain", boxText(docLines, cols, current));

    const node = documentToNode(boxFragment(docLines, cols, current));
    const wrapper = document.createElement("div");
    wrapper.appendChild(clipboardSerializer.serializeFragment(node.content));
    event.clipboardData.setData("text/html", `<div data-pm-slice="1 1 []">${wrapper.innerHTML}</div>`);
    return true;
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const state = EditorState.create({
      doc: documentToNode(initialDocument),
      plugins: [
        // Ahead of everything else: a paste has to be read as terminal output
        // before ProseMirror parses the markup itself, which would take a
        // terminal's per-run elements for one line each.
        pastePlugin(() => latest.current.ansi16()),
        history(),
        keymap({
          "Mod-z": undo,
          "Mod-y": redo,
          "Shift-Mod-z": redo,
          // Through `useFormatting`, so a shortcut lands on the rectangle when
          // one is up and on the selection when it is not — the same choice the
          // toolbar makes, made once.
          "Mod-b": () => (latest.current.formatting.toggleModifier("bold"), true),
          "Mod-i": () => (latest.current.formatting.toggleModifier("italic"), true),
          "Mod-u": () => (latest.current.formatting.toggleModifier("underline"), true),
          "Mod-\\": () => (latest.current.formatting.clearFormatting(), true),
          // A terminal has no tab stops to land on here, and moving focus out of
          // the block mid-edit is worse than inserting the two spaces meant.
          Tab: (editorState, dispatch, view) => {
            // `collapseBox` dispatches, which leaves the state this command was
            // handed one transaction behind — building on it puts the spaces
            // back at the caret the rectangle replaced.
            if (latest.current.box) collapseBox();
            dispatch?.((view?.state ?? editorState).tr.insertText("  ").scrollIntoView());
            return true;
          },
        }),
        keymap(baseKeymap),
        stylePlugin(() => ({
          theme: latest.current.theme,
          halfLeading: latest.current.halfLeading,
          box: latest.current.ranges,
        })),
      ],
    });

    const view = new EditorView(element, {
      state,
      attributes: {
        class: "terminal-editable",
        "aria-label": "Terminal content",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
      /**
       * With a rectangle up, a key that would move a caret or put a character
       * down needs one — so the box gives way rather than swallowing it.
       */
      handleKeyDown(_view, event) {
        const { box: current, ranges: rows, clear: drop } = latest.current;
        if (!current) return false;
        const modifier = event.metaKey || event.ctrlKey;

        if (event.key === "Escape") {
          drop();
          return true;
        }
        if (!modifier && (event.key === "Backspace" || event.key === "Delete")) {
          if (viewRef.current) deleteBox(viewRef.current, rows);
          drop();
          return true;
        }
        if (!modifier && (event.key.length === 1 || event.key.startsWith("Arrow") || event.key === "Enter")) {
          collapseBox();
          return false;
        }
        return false;
      },
      handleDOMEvents: {
        copy: (_view, event) => writeBox(event as ClipboardEvent),
        cut: (_view, event) => {
          if (!writeBox(event as ClipboardEvent)) return false;
          if (viewRef.current) deleteBox(viewRef.current, latest.current.ranges);
          latest.current.clear();
          return true;
        },
      },
      dispatchTransaction(transaction) {
        const next = view.state.apply(transaction);
        view.updateState(next);
        if (transaction.docChanged) latest.current.onChange(nodeToDocument(next.doc));
        latest.current.onSelectionChange?.();
      },
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Built once. `initialDocument` is the seed, not a binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The theme, the leading and the rectangle all live outside the document, so a
  // change to any of them has to ask the decorations to rebuild.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    refreshStyles((meta) => view.dispatch(view.state.tr.setMeta(styleKey, meta)));
  }, [theme, halfLeading, ranges]);

  /**
   * Holding the modifier says what the next drag will do.
   *
   * A gesture that changes meaning with a key held is invisible until you try
   * it; a crosshair is the conventional "you are about to draw a region" cursor
   * and costs nothing to show. Cleared on blur too, because a key released while
   * the window is in the background never sends its `keyup`.
   */
  useEffect(() => {
    const update = (event: globalThis.KeyboardEvent) => setDrawing(event.altKey);
    const drop = () => setDrawing(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", drop);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", drop);
    };
  }, []);

  // Escape drops the box wherever focus is. Reaching for the toolbar must not
  // take the rectangle away, so it survives a blur exactly as a selection does.
  useEffect(() => {
    if (!box) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [box, clear]);

  /**
   * ⌥-drag draws a rectangle; anything else is an ordinary click.
   *
   * The native selection is suppressed for the duration rather than allowed to
   * run alongside — two highlights disagreeing about what is selected is worse
   * than either. That costs the browser's own focus handling, so the editable is
   * focused by hand: the floating toolbar only shows for a focused editor.
   */
  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.altKey) {
      latest.current.clear();
      return;
    }
    const grid = latest.current.measureGrid();
    if (!grid) return;

    event.preventDefault();
    const origin = cellAt(grid, event.clientX, event.clientY);
    window.getSelection()?.removeAllRanges();
    viewRef.current?.focus();

    const move = (moved: globalThis.MouseEvent) => {
      const current = latest.current.measureGrid();
      if (!current) return;
      const cell = cellAt(current, moved.clientX, moved.clientY);
      latest.current.setBox({
        topRow: origin.row,
        bottomRow: cell.row,
        startColumn: origin.column,
        endColumn: cell.column,
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  useImperativeHandle(
    handle,
    (): TerminalHandle => ({
      replaceDocument(document) {
        const view = viewRef.current;
        if (!view) return;
        // A fresh state rather than a replacing transaction: the undo stack
        // addresses the document being thrown away, so keeping it would either
        // throw on the first undo or replay the old document's edits into the new.
        view.updateState(EditorState.create({ doc: documentToNode(document), plugins: view.state.plugins }));
        latest.current.onChange(nodeToDocument(view.state.doc));
        latest.current.onSelectionChange?.();
      },
      view: () => viewRef.current,
    }),
    [],
  );

  return (
    <div
      ref={host}
      className="terminal-surface"
      onMouseDown={handleMouseDown}
      style={{
        width,
        padding,
        fontFamily: FONT_FAMILY,
        fontSize,
        lineHeight: `${lineHeight}px`,
        caretColor: theme.foreground,
        ...(drawing ? { cursor: "crosshair" } : {}),
        /*
         * The block wraps where a terminal of this many columns would, which
         * takes all three of these — `computeLayout` cuts the exported rows to a
         * plain character count and the preview has to land on the same ones.
         *
         * `break-spaces` because a space on the boundary occupies a cell in a
         * terminal; under `pre-wrap` the browser hangs it past the edge and
         * starts the next row one character early. `line-break: anywhere` because
         * the algorithm otherwise refuses to break before a space (UAX #14 LB7)
         * and backs the break up a column. `break-all` is the fallback for a
         * browser without `anywhere`.
         */
        whiteSpace: "break-spaces",
        lineBreak: "anywhere",
        wordBreak: "break-all",
        overflowWrap: "normal",
        ["--boron-wrap-width" as string]: `${wrapWidth}px`,
        ["--boron-selection" as string]: theme.selection,
      }}
    />
  );
}
