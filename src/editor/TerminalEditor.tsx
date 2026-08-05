import { createContext, useCallback, useContext, useMemo, type CSSProperties, type KeyboardEvent } from "react";
import { Editable, type RenderElementProps, type RenderLeafProps } from "slate-react";
import { resolveStyle } from "../core/style.ts";
import { DEFAULT_THEME, type Theme } from "../core/themes.ts";
import type { Marks, SpanRole } from "../core/types.ts";
import { FONT_FAMILY } from "../export/fonts.ts";
import type { BoronEditor } from "./custom-types.ts";
import { createDecorator } from "./decorate.ts";
import { clearFormatting, toggleModifier } from "./marks.ts";

interface LeafSettings {
  theme: Theme;
  /** Grows a filled run's background to the full cell, as a terminal would. */
  halfLeading: number;
}

const LeafContext = createContext<LeafSettings>({ theme: DEFAULT_THEME, halfLeading: 0 });

function Leaf({ attributes, children, leaf }: RenderLeafProps) {
  const { theme, halfLeading } = useContext(LeafContext);
  const { text: _text, boronRole, ...marks } = leaf as typeof leaf & { boronRole?: SpanRole };
  const resolved = resolveStyle(marks as Marks, boronRole ?? "plain", theme);

  const decorations = [
    resolved.underline ? "underline" : null,
    resolved.strikethrough ? "line-through" : null,
  ].filter(Boolean);

  const style: CSSProperties = {
    color: resolved.color,
    fontWeight: resolved.bold ? 700 : 400,
    fontStyle: resolved.italic ? "italic" : "normal",
    // Vertical padding on an inline box paints without changing layout, so the
    // fill matches the exported image exactly.
    ...(resolved.background
      ? { backgroundColor: resolved.background, paddingTop: halfLeading, paddingBottom: halfLeading }
      : {}),
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
  const decorate = useMemo(() => createDecorator(editor), [editor]);
  const leafSettings = useMemo<LeafSettings>(() => ({ theme, halfLeading }), [theme, halfLeading]);
  const renderLeaf = useCallback((props: RenderLeafProps) => <Leaf {...props} />, []);
  const renderElement = useCallback((props: RenderElementProps) => <Line {...props} />, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Tab") {
        event.preventDefault();
        editor.insertText("  ");
        return;
      }
      if (!event.metaKey && !event.ctrlKey) return;
      switch (event.key.toLowerCase()) {
        case "b":
          event.preventDefault();
          toggleModifier(editor, "bold");
          break;
        case "i":
          event.preventDefault();
          toggleModifier(editor, "italic");
          break;
        case "u":
          event.preventDefault();
          toggleModifier(editor, "underline");
          break;
        case "\\":
          event.preventDefault();
          clearFormatting(editor);
          break;
        default:
          break;
      }
    },
    [editor],
  );

  return (
    <LeafContext.Provider value={leafSettings}>
      <Editable
        className="terminal-editable"
        decorate={decorate}
        renderLeaf={renderLeaf}
        renderElement={renderElement}
        onKeyDown={handleKeyDown}
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
