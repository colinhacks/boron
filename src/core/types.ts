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
 * A color, serialized as a string so it can live directly on a Slate leaf.
 *
 * The three forms are the three ways a terminal can be told about a color, and
 * that is the whole point: a `NamedColor` is one of the sixteen SGR codes,
 * `ansi256:<0-255>` is `38;5;n`, and `#rrggbb` is `38;2;r;g;b`. There is no
 * fourth case, because there is no fourth escape sequence — a `rebeccapurple`
 * or an `oklch(…)` would paint on screen and then vanish from the ANSI export,
 * leaving a pixel with nothing behind it.
 *
 * Named colors are kept named rather than resolved to hex so that switching
 * theme re-maps them, and so ANSI export round-trips to the original SGR code.
 */
export type Color = NamedColor | `ansi256:${number}` | `#${string}`;

export function isNamedColor(color: string): color is NamedColor {
  return (NAMED_COLORS as readonly string[]).includes(color);
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Whether an untrusted string is a color Boron can actually emit an escape code
 * for. The type says which shapes are legal; this is what holds the line at the
 * doors the type cannot watch — a share link, a stored workspace.
 */
export function isColor(value: unknown): value is Color {
  if (typeof value !== "string") return false;
  if (isNamedColor(value)) return true;
  if (HEX_COLOR.test(value)) return true;
  if (!value.startsWith("ansi256:")) return false;
  const index = value.slice("ansi256:".length);
  return /^\d{1,3}$/.test(index) && Number(index) <= 255;
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
 * Every modifier that is exactly one SGR code, and nothing else. Membership is
 * decided by that correspondence alone — not by how many emulators honour it.
 */
export const MODIFIER_KEYS = [
  "bold",
  "dim",
  "italic",
  "underline",
  "strikethrough",
  "inverse",
  "hidden",
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
