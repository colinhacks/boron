import { toggleMark } from "prosemirror-commands";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { MODIFIER_KEYS, type Color, type Marks, type ModifierKey } from "../core/types.ts";
import { marksOf, terminalSchema } from "./schema.ts";

const MARK_KEYS = [...MODIFIER_KEYS, "fg", "bg"] as const satisfies readonly (keyof Marks)[];

/**
 * What the toolbar should show as active. Over a range, a mark only counts as
 * active when *every* run in it agrees — otherwise a selection spanning red and
 * green would claim to be red.
 */
export function activeMarks(state: EditorState): Marks {
  const { selection } = state;
  if (selection.empty) return marksOf(state.storedMarks ?? selection.$from.marks());

  let common: Marks | null = null;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (!node.isText) return;
    const marks = marksOf(node.marks);
    if (common === null) {
      common = { ...marks };
      return;
    }
    for (const key of MARK_KEYS) {
      if (common[key] !== marks[key]) delete common[key];
    }
  });
  return common ?? {};
}

export function toggleModifier(view: EditorView, key: ModifierKey): void {
  toggleMark(terminalSchema.marks[key]!)(view.state, view.dispatch);
  view.focus();
}

/**
 * Colours are *set* rather than toggled: picking red over green means red, not
 * nothing. `toggleMark` would clear it when the run already carried a colour.
 */
export function setColor(view: EditorView, key: "fg" | "bg", color: Color | null): void {
  const type = terminalSchema.marks[key]!;
  const { state } = view;
  const { selection } = state;

  if (selection.empty) {
    // Nothing selected: the choice applies to whatever is typed next.
    const kept = (state.storedMarks ?? selection.$from.marks()).filter((mark) => mark.type !== type);
    view.dispatch(state.tr.setStoredMarks(color === null ? kept : [...kept, type.create({ color })]));
    view.focus();
    return;
  }

  const tr = state.tr.removeMark(selection.from, selection.to, type);
  if (color !== null) tr.addMark(selection.from, selection.to, type.create({ color }));
  view.dispatch(tr);
  view.focus();
}

export function clearFormatting(view: EditorView): void {
  const { state } = view;
  const { selection } = state;

  if (selection.empty) {
    view.dispatch(state.tr.setStoredMarks([]));
    view.focus();
    return;
  }

  const tr = state.tr;
  for (const key of MARK_KEYS) {
    tr.removeMark(selection.from, selection.to, terminalSchema.marks[key]!);
  }
  view.dispatch(tr);
  view.focus();
}
