import { useEffect, useRef, useState } from "react";
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
  const [, tick] = useState(0);

  // The anchor moves with the page, and the editor only re-renders on its own
  // changes — so scrolling or resizing has to nudge the position itself.
  useEffect(() => {
    const reposition = () => tick((value) => value + 1);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, []);

  useEffect(() => {
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
    const left = Math.min(
      Math.max(GAP, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - GAP,
    );
    const above = rect.top - height - GAP;
    const top = above > GAP ? above : rect.bottom + GAP;
    element.style.left = `${left + window.scrollX}px`;
    element.style.top = `${top + window.scrollY}px`;
  });

  return createPortal(
    <div
      ref={ref}
      className={`floating-toolbar${visible ? " floating-toolbar--visible" : ""}`}
      role="group"
      aria-label="Formatting"
      aria-hidden={!visible}
    >
      <Toolbar theme={theme} />
    </div>,
    document.body,
  );
}
