import { Editor, Range, Text } from "slate";
import type { Color, Marks, ModifierKey } from "../core/types.ts";

const MARK_KEYS = [
  "fg",
  "bg",
  "bold",
  "dim",
  "italic",
  "underline",
  "strikethrough",
  "inverse",
  "hidden",
] as const satisfies readonly (keyof Marks)[];

/**
 * What the toolbar should show as active. Over a range, a mark only counts as
 * active when *every* text node in it agrees — otherwise a selection spanning
 * red and green would claim to be red.
 */
export function activeMarks(editor: Editor): Marks {
  const { selection } = editor;
  if (!selection || Range.isCollapsed(selection)) return (Editor.marks(editor) ?? {}) as Marks;

  const nodes = Array.from(Editor.nodes(editor, { match: Text.isText, voids: true }));
  let common: Marks | null = null;

  for (const [node] of nodes) {
    const { text: _text, ...marks } = node;
    if (common === null) {
      common = { ...marks } as Marks;
      continue;
    }
    for (const key of MARK_KEYS) {
      if (common[key] !== (marks as Marks)[key]) delete common[key];
    }
  }
  return common ?? {};
}

export function setForeground(editor: Editor, color: Color | null): void {
  if (color === null) Editor.removeMark(editor, "fg");
  else Editor.addMark(editor, "fg", color);
}

export function toggleModifier(editor: Editor, key: ModifierKey): void {
  if (activeMarks(editor)[key] === true) Editor.removeMark(editor, key);
  else Editor.addMark(editor, key, true);
}

export function clearFormatting(editor: Editor): void {
  for (const key of MARK_KEYS) Editor.removeMark(editor, key);
}
