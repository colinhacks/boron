import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Transforms } from "slate";
import { Editable, ReactEditor, type RenderElementProps, type RenderLeafProps } from "slate-react";
import type { LineElement } from "../core/document.ts";
import { resolveStyle } from "../core/style.ts";
import { DEFAULT_THEME, type Theme } from "../core/themes.ts";
import type { Marks, SpanRole } from "../core/types.ts";
import { FONT_FAMILY } from "../export/fonts.ts";
import { boxFragment, boxText, cellAt, deleteBox } from "./box.ts";
import { useBoxSelection } from "./BoxSelection.tsx";
import type { BoronEditor } from "./custom-types.ts";
import { createDecorator } from "./decorate.ts";
import { useFormatting } from "./useFormatting.ts";

interface LeafSettings {
  theme: Theme;
  /** Grows a filled run's background to the full cell, as a terminal would. */
  halfLeading: number;
}

const LeafContext = createContext<LeafSettings>({ theme: DEFAULT_THEME, halfLeading: 0 });

function Leaf({ attributes, children, leaf }: RenderLeafProps) {
  const { theme, halfLeading } = useContext(LeafContext);
  const {
    text: _text,
    boronRole,
    boronBox,
    ...marks
  } = leaf as typeof leaf & { boronRole?: SpanRole; boronBox?: boolean };
  const resolved = resolveStyle(marks as Marks, boronRole ?? "plain", theme);

  const decorations = [
    resolved.underline ? "underline" : null,
    resolved.strikethrough ? "line-through" : null,
  ].filter(Boolean);

  // A box highlight has to sit *over* a filled run rather than replace it, for
  // the same reason the native one is translucent: the fill is what you are
  // there to pick, and painting it out makes every swatch look like it did
  // nothing. `background-image` composites over `background-color`, so one leaf
  // can carry both.
  const highlight = boronBox
    ? {
        backgroundImage: "linear-gradient(var(--boron-selection-fill), var(--boron-selection-fill))",
        paddingTop: halfLeading,
        paddingBottom: halfLeading,
      }
    : {};

  const style: CSSProperties = {
    color: resolved.color,
    fontWeight: resolved.bold ? 700 : 400,
    fontStyle: resolved.italic ? "italic" : "normal",
    // Vertical padding on an inline box paints without changing layout, so the
    // fill matches the exported image exactly.
    ...(resolved.background
      ? { backgroundColor: resolved.background, paddingTop: halfLeading, paddingBottom: halfLeading }
      : {}),
    ...highlight,
    ...(decorations.length > 0 ? { textDecoration: decorations.join(" ") } : {}),
    ...(resolved.opacity !== 1 ? { opacity: resolved.opacity } : {}),
  };

  return (
    <span {...attributes} style={style}>
      {children}
    </span>
  );
}

function Line({ attributes, children }: RenderElementProps) {
  return (
    <div {...attributes} className="terminal-line">
      {children}
    </div>
  );
}

export interface TerminalSurfaceProps {
  editor: BoronEditor;
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  halfLeading: number;
  padding: number;
  width: number;
  /** Where a line wraps. Narrower than `width` when a long title widened the block. */
  wrapWidth: number;
}

/** The editable itself. `<Slate>` lives higher up so the toolbar shares its context. */
export function TerminalSurface({
  editor,
  theme,
  fontSize,
  lineHeight,
  halfLeading,
  padding,
  width,
  wrapWidth,
}: TerminalSurfaceProps) {
  const { box, spans, ranges, columns, measureGrid, setBox, clear } = useBoxSelection();
  const formatting = useFormatting();

  // The commands run from event handlers that shouldn't be rebuilt per keystroke.
  const rangesRef = useRef(ranges);
  rangesRef.current = ranges;

  // A new decorator per box, deliberately: slate-react repaints decorations only
  // when this prop's identity changes. The classification cache lives outside the
  // closure, so rebuilding it costs nothing.
  const decorate = useMemo(() => createDecorator(editor, spans), [editor, spans]);
  const leafSettings = useMemo<LeafSettings>(() => ({ theme, halfLeading }), [theme, halfLeading]);
  const renderLeaf = useCallback((props: RenderLeafProps) => <Leaf {...props} />, []);
  const renderElement = useCallback((props: RenderElementProps) => <Line {...props} />, []);

  /**
   * Alt-drag draws a rectangle; anything else is an ordinary click.
   *
   * The native selection is suppressed for the duration rather than allowed to
   * run alongside — two highlights disagreeing about what is selected is worse
   * than either. That costs the browser's own focus handling, so the editable is
   * focused by hand: the floating toolbar only shows for a focused editor.
   */
  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.altKey) {
        clear();
        return;
      }
      const grid = measureGrid();
      if (!grid) return;

      event.preventDefault();
      const origin = cellAt(grid, event.clientX, event.clientY);

      Transforms.deselect(editor);
      window.getSelection()?.removeAllRanges();
      try {
        ReactEditor.toDOMNode(editor, editor).focus({ preventScroll: true });
      } catch {
        // The editable can be unmounted between measuring and focusing.
      }

      const move = (moved: globalThis.MouseEvent) => {
        const current = measureGrid();
        if (!current) return;
        const cell = cellAt(current, moved.clientX, moved.clientY);
        setBox({
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
    },
    [editor, measureGrid, setBox, clear],
  );

  /**
   * Put the caret where the box started and drop the box.
   *
   * A rectangle has no caret, so anything that wants to type needs somewhere to
   * type *to*. Its own first cell is the least surprising answer — it is where
   * the gesture began and where the eye already is.
   */
  const collapseBox = useCallback(() => {
    const first = rangesRef.current[0];
    clear();
    if (first) Transforms.select(editor, first.anchor);
  }, [editor, clear]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const modifier = event.metaKey || event.ctrlKey;

      if (box) {
        if (event.key === "Escape") {
          event.preventDefault();
          clear();
          return;
        }
        if (!modifier && (event.key === "Backspace" || event.key === "Delete")) {
          event.preventDefault();
          deleteBox(editor, rangesRef.current);
          clear();
          return;
        }
        // Anything else that would move a caret or put a character down needs
        // one, so the box gives way rather than swallowing the keystroke.
        if (!modifier && (event.key.length === 1 || event.key.startsWith("Arrow") || event.key === "Enter")) {
          collapseBox();
          return;
        }
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (box) collapseBox();
        editor.insertText("  ");
        return;
      }
      if (!modifier) return;
      switch (event.key.toLowerCase()) {
        case "b":
          event.preventDefault();
          formatting.toggleModifier("bold");
          break;
        case "i":
          event.preventDefault();
          formatting.toggleModifier("italic");
          break;
        case "u":
          event.preventDefault();
          formatting.toggleModifier("underline");
          break;
        case "\\":
          event.preventDefault();
          formatting.clearFormatting();
          break;
        default:
          break;
      }
    },
    [editor, box, clear, collapseBox, formatting],
  );

  /**
   * Copy the rectangle, colors and all.
   *
   * Both flavours go on, in the two places `withTerminal` looks: plain text for
   * everything else, and Slate's own fragment so pasting back into Boron keeps
   * the palette. A monochrome column out of a tool about color would be half a
   * feature.
   */
  const writeBox = useCallback(
    (event: ClipboardEvent<HTMLDivElement>): boolean => {
      if (!box) return false;
      const lines = editor.children as LineElement[];
      event.preventDefault();
      event.clipboardData.setData("text/plain", boxText(lines, columns, box));
      const fragment = boxFragment(lines, columns, box);
      const encoded = btoa(encodeURIComponent(JSON.stringify(fragment)));
      event.clipboardData.setData("application/x-slate-fragment", encoded);
      return true;
    },
    [editor, box, columns],
  );

  // Returning the boolean rather than leaning on `preventDefault` alone: it is
  // what slate-react's `isEventHandled` reads first, so a box copy says plainly
  // that it has dealt with the event and a plain one falls through to Slate's
  // own handler untouched.
  const handleCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => writeBox(event),
    [writeBox],
  );

  const handleCut = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!writeBox(event)) return false;
      deleteBox(editor, rangesRef.current);
      clear();
      return true;
    },
    [writeBox, editor, clear],
  );

  // Dropping the box when focus leaves the editor would take it away the moment
  // you reach for the toolbar, so it survives a blur exactly as the linear
  // selection does. Escape is the way out, and so is an ordinary click.
  useEffect(() => {
    if (!box) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [box, clear]);

  return (
    <LeafContext.Provider value={leafSettings}>
      <Editable
        className="terminal-editable"
        decorate={decorate}
        renderLeaf={renderLeaf}
        renderElement={renderElement}
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        onCopy={handleCopy}
        onCut={handleCut}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-label="Terminal content"
        style={{
          width,
          padding,
          fontFamily: FONT_FAMILY,
          fontSize,
          lineHeight: `${lineHeight}px`,
          caretColor: theme.foreground,
          /*
           * The block wraps where a terminal of this many columns would, which
           * takes all three of these — `computeLayout` cuts the exported rows to
           * a plain character count (`wrapRenderLines`) and the preview has to
           * land on the same characters.
           *
           * `break-spaces` because a space that falls on the boundary occupies a
           * cell in a terminal; under `pre-wrap` the browser hangs it past the
           * edge and starts the next row one character earlier.
           *
           * `line-break: anywhere` because the line-breaking algorithm otherwise
           * refuses to break *before* a space (UAX #14 LB7) and backs the break
           * up a column when one lands there — measured, not assumed: with it,
           * `"b" × 80 + " x"` breaks after 80; without it, after 79. `anywhere`
           * is defined as disregarding those prohibitions, which is exactly what
           * a terminal does.
           *
           * `break-all` is the fallback for a browser without `anywhere`: it
           * gets everything except the space case right, rather than reflowing
           * to word boundaries the export knows nothing about.
           */
          whiteSpace: "break-spaces",
          lineBreak: "anywhere",
          wordBreak: "break-all",
          overflowWrap: "normal",
          ["--boron-wrap-width" as string]: `${wrapWidth}px`,
          ["--boron-selection" as string]: theme.selection,
        }}
      />
    </LeafContext.Provider>
  );
}
