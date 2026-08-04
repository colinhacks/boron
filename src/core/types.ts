/** The 16 classic chalk color names, in ANSI index order. */
export const NAMED_COLORS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "blackBright",
  "redBright",
  "greenBright",
  "yellowBright",
  "blueBright",
  "magentaBright",
  "cyanBright",
  "whiteBright",
] as const;

export type NamedColor = (typeof NAMED_COLORS)[number];

/**
 * A color, serialized as a string so it can live directly on a Slate leaf:
 * a `NamedColor`, `ansi256:<0-255>`, or `#rrggbb`.
 *
 * Named colors are kept named rather than resolved to hex so that switching
 * theme re-maps them, and so ANSI export round-trips to the original SGR code.
 */
export type Color = string;

export function isNamedColor(color: Color): color is NamedColor {
  return (NAMED_COLORS as readonly string[]).includes(color);
}

/**
 * Styling stored on a Slate text leaf. Every field is optional and absent when
 * off, which keeps the document small — the auto `$`-prompt styling fills in
 * whatever is missing at render time.
 */
export interface Marks {
  fg?: Color;
  bg?: Color;
  bold?: true;
  dim?: true;
  italic?: true;
  underline?: true;
  strikethrough?: true;
  inverse?: true;
  hidden?: true;
}

/**
 * The modifiers the toolbar offers. `hidden` (SGR 8) is deliberately absent:
 * it is "not widely supported" and renders text invisible, which is of no use
 * in a tool for designing terminal output. It stays in `Marks` so that pasted
 * content carrying SGR 8 still round-trips faithfully.
 */
export const MODIFIER_KEYS = [
  "bold",
  "dim",
  "italic",
  "underline",
  "strikethrough",
  "inverse",
] as const;

export type ModifierKey = (typeof MODIFIER_KEYS)[number];

/**
 * What a run of text is, per the `$`-prompt heuristic.
 *
 * - `prompt`  — the `user@host:~$` lead-in, up to and including the marker
 * - `command` — what you typed, after the marker
 * - `output`  — a line that is not a command, in a document that has commands
 * - `plain`   — every line, in a document with no commands at all
 */
export type SpanRole = "prompt" | "command" | "output" | "plain";

export interface RenderSpan {
  text: string;
  marks: Marks;
  role: SpanRole;
}

export interface RenderLine {
  spans: RenderSpan[];
}

/** True when the two mark sets are identical, so adjacent runs can coalesce. */
export function marksEqual(a: Marks, b: Marks): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key as keyof Marks] !== b[key as keyof Marks]) return false;
  }
  return true;
}
