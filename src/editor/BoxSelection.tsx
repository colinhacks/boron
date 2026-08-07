import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LineElement } from "../core/document.ts";
import {
  boxRanges,
  boxSpans,
  isEmptyBox,
  normalizeBox,
  visualRows,
  type BoxRange,
  type BoxSelection,
  type BoxSpan,
  type Grid,
} from "./box.ts";
import { useEditorView } from "./context.tsx";

interface BoxSelectionValue {
  /** The live rectangle, or `null` when the ordinary linear selection is in charge. */
  box: BoxSelection | null;
  /** The runs it covers, one per row, already clipped to the text that's there. */
  spans: BoxSpan[];
  /** Those same runs as ranges — what the commands take. */
  ranges: BoxRange[];
  /** How many cells wide the terminal is. The box's coordinates are in these. */
  columns: number;
  /** The character grid in client coordinates, or `null` before there is one to measure. */
  measureGrid: () => Grid | null;
  setBox: (box: BoxSelection | null) => void;
  clear: () => void;
}

const BoxSelectionContext = createContext<BoxSelectionValue>({
  box: null,
  spans: [],
  ranges: [],
  columns: 0,
  measureGrid: () => null,
  setBox: () => {},
  clear: () => {},
});

export interface BoxSelectionProviderProps {
  /**
   * The document the box is measured against. Passed in rather than read off the
   * editor: the rectangle is geometry over lines of text, and nothing about it
   * needs to know which editor produced them.
   */
  lines: readonly LineElement[];
  /** Terminal width in cells — where rows wrap, and how far right a box may reach. */
  columns: number;
  /** One cell's advance, unscaled. The whole coordinate system rests on it. */
  charWidth: number;
  lineHeight: number;
  children: ReactNode;
}

/**
 * Holds the rectangular selection, and owns the coordinate system it is
 * expressed in.
 *
 * Both of the things that draw a box — the surface that highlights it and the
 * toolbar that floats over it — have to agree on where column 12 of row 3 is, so
 * the measurement lives here once rather than in each of them.
 *
 * The box lives in React state rather than on the editor, so a change re-renders
 * the things that draw it. Nothing outside a component ever needs to read it:
 * the commands are reached through `useFormatting`, which resolves the box to
 * ranges first.
 *
 * The ranges are derived, not stored. A box is a rectangle in screen
 * coordinates and the document underneath it can change — recomputing means the
 * highlight can never address a node that has since been split or deleted.
 */
export function BoxSelectionProvider({
  lines,
  columns,
  charWidth,
  lineHeight,
  children,
}: BoxSelectionProviderProps) {
  const { view } = useEditorView();
  const [box, setBoxState] = useState<BoxSelection | null>(null);

  const setBox = useCallback((next: BoxSelection | null) => {
    setBoxState(next === null || isEmptyBox(normalizeBox(next)) ? null : normalizeBox(next));
  }, []);

  const clear = useCallback(() => setBoxState(null), []);

  // The box is addressed in rows and columns of a terminal this wide, so a width
  // change reinterprets every coordinate in it. Dropping it is the honest
  // response — the rectangle you dragged is not the rectangle those numbers mean
  // any more.
  useEffect(() => clear(), [columns, clear]);

  /**
   * The scale comes out of the element rather than being passed down: the
   * preview sits inside a `transform: scale(...)`, and `getBoundingClientRect`
   * reports the scaled box while `offsetWidth` reports the unscaled one, so
   * their ratio is the factor without anyone having to keep a prop in sync.
   */
  const measureGrid = useCallback((): Grid | null => {
    if (charWidth <= 0 || lineHeight <= 0) return null;
    // No editable mounted yet — the font is still loading.
    const node = view?.dom as HTMLElement | undefined;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const scale = node.offsetWidth > 0 ? rect.width / node.offsetWidth : 1;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    // `view.dom` is the element the text is laid out in, so its top-left *is*
    // cell (0, 0). Slate's equivalent was the element carrying the padding, and
    // this used to add that padding back on — which put every cell one padding
    // down and to the right of the pointer. Measured against the first
    // character's own rect, not reasoned about.
    return {
      left: rect.left,
      top: rect.top,
      charWidth: charWidth * scale,
      lineHeight: lineHeight * scale,
      columns,
      rowCount: visualRows(lines, columns).length,
    };
  }, [view, lines, charWidth, lineHeight, columns]);

  const spans = useMemo(() => (box ? boxSpans(lines, columns, box) : []), [box, columns, lines]);
  const ranges = useMemo(() => (box ? boxRanges(lines, columns, box) : []), [box, columns, lines]);

  const value = useMemo<BoxSelectionValue>(
    () => ({ box, spans, ranges, columns, measureGrid, setBox, clear }),
    [box, spans, ranges, columns, measureGrid, setBox, clear],
  );

  return <BoxSelectionContext.Provider value={value}>{children}</BoxSelectionContext.Provider>;
}

export function useBoxSelection(): BoxSelectionValue {
  return useContext(BoxSelectionContext);
}
