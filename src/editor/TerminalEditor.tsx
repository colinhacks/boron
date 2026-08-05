import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { TerminalDocument } from "../core/document.ts";
import type { Theme } from "../core/themes.ts";
import { FONT_FAMILY } from "../export/fonts.ts";
import { refreshStyles, styleKey, stylePlugin } from "./decorations.ts";
import { clearFormatting } from "./marks.ts";
import { pastePlugin } from "./paste.ts";
import { documentToNode, nodeToDocument, terminalSchema } from "./schema.ts";

/** What the app can ask of the editor from outside. */
export interface TerminalHandle {
  /** Swap the whole document out — Reset, or opening someone else's workspace. */
  replaceDocument: (document: TerminalDocument) => void;
  view: () => EditorView | null;
}

export interface TerminalSurfaceProps {
  initialDocument: TerminalDocument;
  theme: Theme;
  ansi16: () => readonly string[];
  fontSize: number;
  lineHeight: number;
  halfLeading: number;
  padding: number;
  width: number;
  /** Where a line wraps. Narrower than `width` when a long title widened the block. */
  wrapWidth: number;
  onChange: (document: TerminalDocument) => void;
  /** Fires on every transaction, so the toolbars can re-read the active marks. */
  onSelectionChange?: () => void;
  handle?: Ref<TerminalHandle>;
}

export function TerminalSurface({
  initialDocument,
  theme,
  ansi16,
  fontSize,
  lineHeight,
  halfLeading,
  padding,
  width,
  wrapWidth,
  onChange,
  onSelectionChange,
  handle,
}: TerminalSurfaceProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Read through refs so the view is built once and never torn down: recreating
  // it would drop the selection, the undo stack and the focus on every render.
  const latest = useRef({ theme, halfLeading, onChange, onSelectionChange, ansi16 });
  latest.current = { theme, halfLeading, onChange, onSelectionChange, ansi16 };

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const state = EditorState.create({
      doc: documentToNode(initialDocument),
      plugins: [
        history(),
        keymap({
          "Mod-z": undo,
          "Mod-y": redo,
          "Shift-Mod-z": redo,
          "Mod-b": toggleMark(terminalSchema.marks.bold!),
          "Mod-i": toggleMark(terminalSchema.marks.italic!),
          "Mod-u": toggleMark(terminalSchema.marks.underline!),
          "Mod-\\": (_state, _dispatch, view) => {
            if (!view) return false;
            clearFormatting(view);
            return true;
          },
          // A terminal has no tab stops to land on here, and moving focus out of
          // the block mid-edit is worse than inserting the two spaces meant.
          Tab: (state, dispatch) => {
            dispatch?.(state.tr.insertText("  ").scrollIntoView());
            return true;
          },
        }),
        keymap(baseKeymap),
        stylePlugin(() => ({ theme: latest.current.theme, halfLeading: latest.current.halfLeading })),
        pastePlugin(() => latest.current.ansi16()),
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
    // Built once. `initialDocument` is the seed, not a binding — later changes
    // arrive through `replaceDocument`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The theme and the leading live outside the document, so a change to either
  // has to ask the decorations to rebuild.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    refreshStyles((meta) => view.dispatch(view.state.tr.setMeta(styleKey, meta)));
  }, [theme, halfLeading]);

  useImperativeHandle(
    handle,
    (): TerminalHandle => ({
      replaceDocument(document) {
        const view = viewRef.current;
        if (!view) return;
        // A fresh state rather than a replacing transaction: the undo stack
        // addresses the document being thrown away, so keeping it would either
        // throw on the first undo or replay the old document's edits into the new.
        view.updateState(
          EditorState.create({
            doc: documentToNode(document),
            plugins: view.state.plugins,
          }),
        );
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
      style={{
        width,
        padding,
        fontFamily: FONT_FAMILY,
        fontSize,
        lineHeight: `${lineHeight}px`,
        caretColor: theme.foreground,
        /*
         * The block wraps where a terminal of this many columns would, which
         * takes all three of these — `computeLayout` cuts the exported rows to a
         * plain character count (`wrapRenderLines`) and the preview has to land
         * on the same characters.
         *
         * `break-spaces` because a space that falls on the boundary occupies a
         * cell in a terminal; under `pre-wrap` the browser hangs it past the edge
         * and starts the next row one character earlier.
         *
         * `line-break: anywhere` because the line-breaking algorithm otherwise
         * refuses to break *before* a space (UAX #14 LB7) and backs the break up
         * a column when one lands there. `anywhere` is defined as disregarding
         * those prohibitions, which is exactly what a terminal does.
         *
         * `break-all` is the fallback for a browser without `anywhere`.
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
