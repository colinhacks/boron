import { NAMED_COLORS, type Color, type NamedColor } from "./types.ts";

/** xterm's 6x6x6 color cube levels. */
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

function hex(r: number, g: number, b: number): `#${string}` {
  const to = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** xterm-256 entries 16-255. Indices 0-15 come from the active theme instead. */
const XTERM_EXTENDED: string[] = (() => {
  const out: string[] = [];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        out.push(hex(CUBE_LEVELS[r]!, CUBE_LEVELS[g]!, CUBE_LEVELS[b]!));
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    out.push(hex(v, v, v));
  }
  return out;
})();

/** The xterm-256 value for `index`, using `ansi16` for the first sixteen. */
export function xterm256(index: number, ansi16: readonly string[]): string {
  if (index < 16) return ansi16[index] ?? "#000000";
  return XTERM_EXTENDED[index - 16] ?? "#000000";
}

export function namedColorIndex(name: NamedColor): number {
  return NAMED_COLORS.indexOf(name);
}

/**
 * The SGR parameter that names a color — `30`-`37` for the eight, `90`-`97` for
 * the bright ones, and the `40`/`100` rows for a background.
 *
 * Both places that emit an escape code for a named color come through here:
 * `toAnsi` on the way out of a document, and the syntax highlighter on the way
 * in. Two copies of this arithmetic is a bug with a delay on it — nothing throws
 * when they drift, a highlighted keyword just stops round-tripping to the code
 * it was written as.
 */
export function namedColorSgr(name: NamedColor, background = false): number {
  const base = background ? 40 : 30;
  const index = namedColorIndex(name);
  return index < 8 ? base + index : base + 60 + (index - 8);
}

/**
 * Build a `Color` from an ANSI 256 index, preferring the named form for 0-15.
 *
 * `null` outside 0-255, because there is no such color. A program only has to
 * emit `38;5;256` — an off-by-one on a 256-color palette — for the alternative
 * to be a leaf holding `ansi256:256`, which paints as invalid CSS in the editor
 * and serializes back to no escape code at all.
 */
export function colorFromAnsi256(index: number): Color | null {
  if (!Number.isInteger(index) || index < 0 || index > 255) return null;
  if (index < 16) return NAMED_COLORS[index]!;
  return `ansi256:${index}`;
}

export function parseAnsi256(color: Color): number | null {
  if (!color.startsWith("ansi256:")) return null;
  const n = Number.parseInt(color.slice("ansi256:".length), 10);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb`, `#rrggbb`, `rgb(r g b)` or `rgb(r, g, b [/ a])`. */
export function parseCssColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  if (value.startsWith("#")) {
    const body = value.slice(1);
    if (body.length === 3 || body.length === 4) {
      const [r, g, b] = [body[0]!, body[1]!, body[2]!];
      return {
        r: Number.parseInt(r + r, 16),
        g: Number.parseInt(g + g, 16),
        b: Number.parseInt(b + b, 16),
      };
    }
    if (body.length === 6 || body.length === 8) {
      return {
        r: Number.parseInt(body.slice(0, 2), 16),
        g: Number.parseInt(body.slice(2, 4), 16),
        b: Number.parseInt(body.slice(4, 6), 16),
      };
    }
    return null;
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(value);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    if (r === undefined || g === undefined || b === undefined) return null;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  return null;
}

export function rgbToHex({ r, g, b }: Rgb): `#${string}` {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return hex(clamp(r), clamp(g), clamp(b));
}

/**
 * How far SGR 2 pulls a color toward the background. Real terminals implement
 * "faint" as roughly half intensity; every dimmed thing in Boron goes through
 * this one number so `dim` means exactly one thing on screen and on export.
 */
export const DIM_BLEND = 0.45;

/** Mix `from` toward `to` by `amount` (0 = from, 1 = to). */
export function blend(from: string, to: string, amount: number): string {
  const a = parseCssColor(from);
  const b = parseCssColor(to);
  if (!a || !b) return from;
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

export function relativeLuminance(color: string): number {
  const rgb = parseCssColor(color);
  if (!rgb) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

const DISTANCE_TOLERANCE = 24;

/**
 * Map an arbitrary CSS color back onto the palette, so a rich-text paste from a
 * terminal keeps its *semantic* color (`green`) rather than one theme's idea of
 * what green looks like. Falls back to the literal hex when nothing is close.
 *
 * `null` when the input is not a color this can read at all. Passing it through
 * unchanged would be the tempting thing to do and the wrong one: it would put a
 * value on a leaf that no escape code can express, so the run would paint in the
 * editor and then export as unstyled text.
 */
export function nearestPaletteColor(input: string, ansi16: readonly string[]): Color | null {
  const target = parseCssColor(input);
  if (!target) return null;

  let best: { color: Color; distance: number } | null = null;
  const consider = (color: Color, candidate: string) => {
    const rgb = parseCssColor(candidate);
    if (!rgb) return;
    const distance = Math.hypot(rgb.r - target.r, rgb.g - target.g, rgb.b - target.b);
    if (!best || distance < best.distance) best = { color, distance };
  };

  ansi16.forEach((candidate, index) => consider(NAMED_COLORS[index]!, candidate));
  for (const known of KNOWN_TERMINAL_PALETTES) {
    known.forEach((candidate, index) => consider(NAMED_COLORS[index]!, candidate));
  }

  const winner = best as { color: Color; distance: number } | null;
  if (winner && winner.distance <= DISTANCE_TOLERANCE) return winner.color;
  return rgbToHex(target);
}

/**
 * ANSI palettes shipped by the terminals people actually copy out of, so their
 * exact hex values reverse-map to names even when Boron's own theme differs.
 */
const KNOWN_TERMINAL_PALETTES: readonly (readonly string[])[] = [
  // VS Code integrated terminal (dark+)
  [
    "#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
    "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#e5e5e5",
  ],
  // xterm
  [
    "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
    "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
  ],
  // macOS Terminal.app "Basic"
  [
    "#000000", "#c23621", "#25bc24", "#adad27", "#492ee1", "#d338d3", "#33bbc8", "#cbcccd",
    "#818383", "#fc391f", "#31e722", "#eaec23", "#5833ff", "#f935f8", "#14f0f0", "#e9ebeb",
  ],
  // iTerm2 default
  [
    "#000000", "#c91b00", "#00c200", "#c7c400", "#0225c7", "#c930c7", "#00c5c7", "#c7c7c7",
    "#686868", "#ff6e67", "#5ffa68", "#fffc67", "#6871ff", "#ff77ff", "#60fdff", "#ffffff",
  ],
];
