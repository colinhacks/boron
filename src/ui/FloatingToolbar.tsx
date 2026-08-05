import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Editor, Range } from "slate";
import { ReactEditor, useSlate } from "slate-react";
import type { Theme } from "../core/themes.ts";
import { Toolbar } from "./Toolbar.tsx";

const GAP = 10;

/**
 * The formatting controls, floating over whatever you have selected.
 *
 * Rendered into a portal so the stage's own transform and overflow can't clip
 * or mis-scale it, and hidden with opacity rather than `display` so it can
 * still be measured while off-screen.
 */
export function FloatingToolbar({ theme }: { theme: Theme }) {
  const editor = useSlate();
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  const sync = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    const { selection } = editor;
    if (
      !selection ||
      Range.isCollapsed(selection) ||
      !ReactEditor.isFocused(editor) ||
      Editor.string(editor, selection) === ""
    ) {
      setVisible(false);
      return;
    }

    // The model can outlive what's actually highlighted — Slate keeps its last
    // selection when focus leaves, and a browser can drop the native one without
    // telling it. Trust the DOM for "is anything still selected", so the toolbar
    // never hangs around over nothing.
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
      setVisible(false);
      return;
    }

    let rect: DOMRect;
    try {
      rect = ReactEditor.toDOMRange(editor, selection).getBoundingClientRect();
    } catch {
      // The DOM can lag the model for a tick after a paste or an undo.
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
  }, [editor]);

  // Every editor change — which is what keeps the toolbar over the selection.
  useEffect(sync);

  useEffect(() => {
    // Scrolling and resizing move the anchor without changing the editor.
    //
    // Losing focus is the one that actually bites: blurring the editor produces
    // no Slate operation, so `useSlate` never re-renders us and the toolbar
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
