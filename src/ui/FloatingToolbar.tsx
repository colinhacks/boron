import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Theme } from "../core/themes.ts";
import { useEditorView } from "../editor/context.tsx";
import { boxRect } from "../editor/box.ts";
import { useBoxSelection } from "../editor/BoxSelection.tsx";
import { Toolbar } from "./Toolbar.tsx";

const GAP = 10;

/** All `sync` needs of a highlight. A `DOMRect` satisfies it, and so does a box. */
interface Anchor {
  left: number;
  top: number;
  bottom: number;
}

/**
 * The formatting controls, floating over whatever you have selected.
 *
 * Rendered into a portal so the stage's own transform and overflow can't clip
 * or mis-scale it, and hidden with opacity rather than `display` so it can
 * still be measured while off-screen.
 */
export function FloatingToolbar({ theme }: { theme: Theme }) {
  const { view } = useEditorView();
  const { box, spans, measureGrid } = useBoxSelection();
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  /**
   * Where the highlight is, whichever kind it is — or `null` for "nothing worth
   * opening the bar over".
   *
   * A box is checked first and short-circuits the rest: it suppresses the native
   * selection while it is up, so every test below it would fail on a rectangle
   * that is plainly there on screen.
   */
  const anchorRect = useCallback((): Anchor | null => {
    if (box) {
      if (spans.length === 0) return null;
      const grid = measureGrid();
      return grid ? boxRect(grid, box) : null;
    }

    if (!view) return null;
    const { selection } = view.state;
    if (selection.empty || !view.hasFocus() || view.state.doc.textBetween(selection.from, selection.to) === "") {
      return null;
    }

    // The model can outlive what's actually highlighted — Slate keeps its last
    // selection when focus leaves, and a browser can drop the native one without
    // telling it either. Trust the DOM for "is anything still selected", so the toolbar
    // never hangs around over nothing.
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) return null;

    try {
      // `coordsAtPos` is viewport-relative like a DOMRect, and unlike a DOM range
      // it stays correct where the selection spans several lines.
      const start = view.coordsAtPos(selection.from);
      const end = view.coordsAtPos(selection.to);
      return {
        left: Math.min(start.left, end.left),
        top: Math.min(start.top, end.top),
        bottom: Math.max(start.bottom, end.bottom),
      };
    } catch {
      // The DOM can lag the model for a tick after a paste or an undo.
      return null;
    }
  }, [view, box, spans, measureGrid]);

  const sync = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    const rect = anchorRect();
    if (!rect) {
      setVisible(false);
      return;
    }

    setVisible(true);
    const { offsetWidth: width, offsetHeight: height } = element;
    // Bottom-left corner pinned to the start of the highlight, so the toolbar
    // opens up and to the right and covers the lines above rather than the
    // selection itself. Pulled back in when that overhangs the right edge, and
    // dropped underneath when there is no room above.
    const left = Math.min(Math.max(GAP, rect.left), window.innerWidth - width - GAP);
    const above = rect.top - height - GAP;
    const top = above > GAP ? above : rect.bottom + GAP;
    element.style.left = `${left + window.scrollX}px`;
    element.style.top = `${top + window.scrollY}px`;
  }, [anchorRect]);

  // Every editor change — which is what keeps the toolbar over the selection.
  useEffect(sync);

  useEffect(() => {
    // Scrolling and resizing move the anchor without changing the editor.
    //
    // Losing focus is the one that actually bites: blurring the editor produces
    // no transaction, so nothing re-renders us and the toolbar
    // outlives the selection it belongs to — it just sits there after you click
    // away. Focus events are deferred a frame because slate-react clears its own
    // focus flag in a handler that has not necessarily run yet.
    const soon = () => requestAnimationFrame(sync);
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    document.addEventListener("selectionchange", sync);
    window.addEventListener("focusin", soon);
    window.addEventListener("blur", soon, true);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
      document.removeEventListener("selectionchange", sync);
      window.removeEventListener("focusin", soon);
      window.removeEventListener("blur", soon, true);
    };
  }, [sync]);

  return createPortal(
    <div
      ref={ref}
      className={`floating-toolbar${visible ? " floating-toolbar--visible" : ""}`}
      role="group"
      aria-label="Formatting"
      /*
       * Keep focus in the editor for any press inside the bar — not just on the
       * buttons, which guarded themselves, but on the 5px between two swatches,
       * the label column and the padding. The bar is a portal and nothing in it
       * is focusable, so a press that misses a button sends focus to <body>; the
       * editor blurs, and the bar hides itself out from under the click.
       */
      onMouseDown={(event) => event.preventDefault()}
      // Parked off-screen at opacity 0 rather than `display: none`, so it stays
      // measurable — but that leaves three dozen buttons in the tab order. `inert`
      // takes them out of it and out of the a11y tree without costing the layout.
      inert={!visible}
    >
      <Toolbar theme={theme} />
    </div>,
    document.body,
  );
}
