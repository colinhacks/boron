import { DIM_BLEND, blend, namedColorIndex, parseAnsi256, xterm256 } from "./palette.ts";
import type { Theme } from "./themes.ts";
import { isNamedColor, type Color, type Marks, type SpanRole } from "./types.ts";

export interface ResolvedStyle {
  color: string;
  background: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  opacity: number;
}

/** Resolve a stored `Color` to a concrete CSS color under the active theme. */
export function colorToCss(color: Color, theme: Theme): string {
  if (isNamedColor(color)) return theme.ansi[namedColorIndex(color)] ?? theme.foreground;
  const index = parseAnsi256(color);
  if (index !== null) return xterm256(index, theme.ansi);
  return color;
}

/**
 * The chalk marks the `$`-prompt heuristic *implies* for a run.
 *
 * Expressed as marks rather than as colors, and independent of the theme: a
 * command is bold (SGR 1) and output is faint (SGR 2), everywhere. Picking the
 * mark per theme — bright white on dark profiles, black on light ones — would
 * make one document serialize to two different escape sequences, and there is
 * only one correct answer for a given document.
 *
 * Bold rather than bright white because it is the one emphasis that stays
 * legible against any palette — including light profiles, where bright white
 * *is* the background.
 */
export function roleMarks(role: SpanRole): Marks {
  switch (role) {
    case "command":
      return { bold: true };
    case "prompt":
    case "output":
      return { dim: true };
    default:
      return {};
  }
}

/**
 * Merge the implied role marks with the explicit ones. Explicit always wins,
 * and a run that carries its own color keeps its full intensity — the auto-dim
 * is the fallback for *uncolored* output, not a filter over everything. That is
 * what lets pasted ANSI stay vivid while plain output recedes.
 */
export function effectiveMarks(marks: Marks, role: SpanRole): Marks {
  const implied = roleMarks(role);
  if (marks.fg !== undefined) {
    const { dim: _dim, ...rest } = implied;
    return { ...rest, ...marks };
  }
  return { ...implied, ...marks };
}

/**
 * The single place a run becomes pixels. The editor's leaves, the canvas and
 * the SVG all call this, so what you see is what gets exported.
 */
export function resolveStyle(marks: Marks, role: SpanRole, theme: Theme): ResolvedStyle {
  const effective = effectiveMarks(marks, role);

  let color = effective.fg !== undefined ? colorToCss(effective.fg, theme) : theme.foreground;
  let background = effective.bg !== undefined ? colorToCss(effective.bg, theme) : null;

  if (effective.inverse === true) {
    const previousForeground = color;
    color = background ?? theme.background;
    background = previousForeground;
  }

  if (effective.dim === true) color = blend(color, background ?? theme.background, DIM_BLEND);

  return {
    color,
    background,
    bold: effective.bold === true,
    italic: effective.italic === true,
    underline: effective.underline === true,
    strikethrough: effective.strikethrough === true,
    opacity: effective.hidden === true ? 0 : 1,
  };
}

/** The dimmed default foreground — what SGR 2 looks like on this theme. */
export function dimmedForeground(theme: Theme): string {
  return blend(theme.foreground, theme.background, DIM_BLEND);
}
