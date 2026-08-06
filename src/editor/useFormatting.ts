import { useMemo } from "react";
import { useSlate } from "slate-react";
import type { Color, Marks, ModifierKey } from "../core/types.ts";
import { boxMarks, clearBoxFormatting, setBoxColor, toggleBoxModifier } from "./box.ts";
import { useBoxSelection } from "./BoxSelection.tsx";
import { activeMarks, clearFormatting, setColor, toggleModifier } from "./marks.ts";

export interface Formatting {
  /** What the toolbar should light up — the marks the whole selection agrees on. */
  marks: Marks;
  setColor: (key: "fg" | "bg", color: Color | null) => void;
  toggleModifier: (key: ModifierKey) => void;
  clearFormatting: () => void;
}

/**
 * The formatting commands, already pointed at whichever selection is live.
 *
 * There are two — the ordinary linear one and a rectangle — and every caller
 * wants the same thing from both, so the choice is made once here instead of at
 * each of the twenty-odd controls. A box wins whenever one exists, including
 * when it covers no text at all: a rectangle dragged over blank space should do
 * nothing, not quietly redirect the click to a caret somewhere else.
 */
export function useFormatting(): Formatting {
  const editor = useSlate();
  const { box, ranges } = useBoxSelection();
  const boxed = box !== null;

  const marks = boxed ? boxMarks(editor, ranges) : activeMarks(editor);

  const commands = useMemo<Omit<Formatting, "marks">>(
    () => ({
      setColor: (key, color) =>
        boxed ? setBoxColor(editor, ranges, key, color) : setColor(editor, key, color),
      toggleModifier: (key) =>
        boxed ? toggleBoxModifier(editor, ranges, key) : toggleModifier(editor, key),
      clearFormatting: () => (boxed ? clearBoxFormatting(editor, ranges) : clearFormatting(editor)),
    }),
    [editor, boxed, ranges],
  );

  return { marks, ...commands };
}
