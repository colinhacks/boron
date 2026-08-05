import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { classifyDocument, hasCommands } from "../core/prompt.ts";
import { resolveStyle } from "../core/style.ts";
import type { Theme } from "../core/themes.ts";
import type { Marks, SpanRole } from "../core/types.ts";
import type { BoxRange } from "./box.ts";
import { marksOf } from "./schema.ts";

export interface StyleSettings {
  theme: Theme;
  /** Grows a filled run's background to the full cell, as a terminal would. */
  halfLeading: number;
  /** The ⌥-drag rectangle, if one is up. */
  box: readonly BoxRange[];
}

export const styleKey = new PluginKey<DecorationSet>("boron-style");

/**
 * Turn a run into the inline style it should paint with.
 *
 * Everything goes through `resolveStyle`, which is also what `computeLayout` and
 * both exporters call. That is the invariant: one funnel from marks to pixels, so
 * the preview cannot drift from the image you save.
 */
function styleFor(marks: Marks, role: SpanRole, { theme, halfLeading }: StyleSettings): string {
  const resolved = resolveStyle(marks, role, theme);
  const parts = [
    `color:${resolved.color}`,
    `font-weight:${resolved.bold ? 700 : 400}`,
    `font-style:${resolved.italic ? "italic" : "normal"}`,
  ];
  if (resolved.background) {
    // Vertical padding on an inline box paints without changing layout, so the
    // fill matches the exported image exactly.
    parts.push(
      `background-color:${resolved.background}`,
      `padding-top:${halfLeading}px`,
      `padding-bottom:${halfLeading}px`,
    );
  }
  const lines = [resolved.underline ? "underline" : null, resolved.strikethrough ? "line-through" : null].filter(
    Boolean,
  );
  if (lines.length > 0) parts.push(`text-decoration:${lines.join(" ")}`);
  if (resolved.opacity !== 1) parts.push(`opacity:${resolved.opacity}`);
  return parts.join(";");
}

/**
 * Appearance for the whole document, as decorations.
 *
 * Two things are deliberately *not* in the document and so have to be applied
 * here: the theme, which decides what `green` looks like, and the `$`-prompt
 * heuristic, which decides that a command is bold and its output faint. Storing
 * either as marks would freeze one reading — edit the first line so it stops
 * being a command and everything under it would stay dimmed.
 *
 * Classification is whole-document (a trailing `\` continues a command onto the
 * next line, and a document with no commands at all must not dim everything), so
 * it runs once per rebuild rather than per run.
 */
function build(doc: PMNode, settings: StyleSettings): DecorationSet {
  const texts: string[] = [];
  doc.forEach((line) => texts.push(line.textContent));
  const classifications = classifyDocument(texts);
  const commandsPresent = hasCommands(classifications);

  const decorations: Decoration[] = [];
  let lineIndex = 0;

  doc.forEach((line, lineOffset) => {
    const classification = classifications[lineIndex++];
    if (!classification) return;
    // +1 steps past the line node's own opening token to its first character.
    const lineStart = lineOffset + 1;
    let offset = 0;

    line.forEach((child) => {
      const text = child.text;
      if (!child.isText || !text) return;
      const marks = marksOf(child.marks);
      const from = lineStart + offset;
      const push = (start: number, end: number, role: SpanRole) => {
        decorations.push(Decoration.inline(from + start, from + end, { style: styleFor(marks, role, settings) }));
      };

      if (classification.kind !== "command") {
        push(0, text.length, commandsPresent ? "output" : "plain");
      } else {
        // The prompt runs up to the marker; what you typed follows it. The split
        // can land inside a single run, which is why it is measured in characters
        // rather than taken at a run boundary.
        const boundary = classification.commandStart - offset;
        if (boundary <= 0) push(0, text.length, "command");
        else if (boundary >= text.length) push(0, text.length, "prompt");
        else {
          push(0, boundary, "prompt");
          push(boundary, text.length, "command");
        }
      }
      offset += text.length;
    });
  });

  // The box highlight goes on last so it composes *over* a filled run rather
  // than replacing it — the same reason the native selection is translucent. The
  // fill is what you are there to pick, and painting it out makes every swatch
  // look like it did nothing. `background-image` layers over `background-color`.
  for (const range of settings.box) {
    if (range.from === range.to) continue;
    decorations.push(
      Decoration.inline(range.from, range.to, {
        style:
          "background-image:linear-gradient(var(--boron-selection-fill),var(--boron-selection-fill));" +
          `padding-top:${settings.halfLeading}px;padding-bottom:${settings.halfLeading}px`,
      }),
    );
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * `getSettings` is read on every rebuild rather than captured, so a theme change
 * only has to dispatch a transaction carrying this plugin's meta flag — see
 * `refreshStyles`.
 */
export function stylePlugin(getSettings: () => StyleSettings): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: styleKey,
    state: {
      init: (_config, state) => build(state.doc, getSettings()),
      apply: (tr, previous, _old, next) =>
        tr.docChanged || tr.getMeta(styleKey) === true ? build(next.doc, getSettings()) : previous,
    },
    props: {
      decorations(state) {
        return styleKey.getState(state);
      },
    },
  });
}

/** Ask for a repaint when something outside the document changed. */
export function refreshStyles(dispatch: (meta: true) => void): void {
  dispatch(true);
}
