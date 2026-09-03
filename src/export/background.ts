import { clampChroma, formatHex, modeOklch, modeRgb, useMode } from "culori/fn";

useMode(modeRgb);
useMode(modeOklch);

export interface Background {
  id: string;
  name: string;
  /** CSS angle in degrees: 0 points up, increasing clockwise. */
  angle: number;
  stops: readonly string[];
}

/** `null` means a transparent frame — the PNG keeps its alpha channel. */
export const TRANSPARENT_ID = "none";

/**
 * The backdrops are placed on a grid rather than picked by eye.
 *
 * The set they replaced clustered badly: six of the eight had an endpoint in the
 * blue/violet 200-300° band, sweeps ran anywhere from 27° to 114° with nothing
 * explaining why, lightness ranged 0.16 to 0.87 with no ramp, and there was no
 * green at all — "Mint" started at 163°, which is teal.
 *
 * Anchors are spaced 42-75° apart, placed where each name's hue actually lives
 * rather than on a strict 60° grid, and every gradient travels the same arc
 * centred on its anchor, so the name describes its middle. Sand sits at 82°
 * rather than the even-grid 95° because 95 put its tail in lime — the same
 * complaint as Mint having been teal, and the spacing is worth less than the
 * names being true. Distinctness is unaffected either way: the closest pair is
 * Mint against Arctic, which neither anchor touches.
 *
 * Lightness *alternates* around the wheel rather than following each hue's
 * natural luminance, which is the tempting rule and the wrong one. Following
 * natural luminance bunched Mint, Arctic and Sand together at the light end,
 * and on Dracula two of them once rendered an OKLab distance of 0.044 apart —
 * two identical-looking options in the picker. `themedBackground` now gives
 * every backdrop its own arc of the theme's hue wheel, so that exact collapse
 * cannot recur — but neighbouring arcs still meet at a shared accent, and the
 * alternation is what keeps wheel-neighbours reading as different swatches
 * rather than one ramp cut in two. `background.test.ts` holds the perceptual
 * line on every pair.
 */
const SWEEP = 55;

/**
 * Authored saturation, deliberately above what most themes will allow.
 * `themedBackground` caps each stop at the theme's own chroma, so this is the
 * headroom that cap works against rather than a promise. At 0.16 it sat *below*
 * the cap for five of the eight themes, which quietly made the adaptation a
 * no-op for them; at 0.22 the theme is what decides, which is the whole point.
 */
const CHROMA = 0.22;

/** How much darker a gradient ends than it starts. */
const FALL = 0.12;

interface Backdrop {
  id: string;
  name: string;
  /** Hue at the middle of the sweep, in degrees. */
  anchor: number;
  /** Lightness at the middle of the sweep, 0-1. */
  lightness: number;
}

const BACKDROPS: readonly Backdrop[] = [
  { id: "midnight", name: "Midnight", anchor: 265, lightness: 0.44 },
  { id: "ember", name: "Ember", anchor: 40, lightness: 0.56 },
  { id: "mint", name: "Mint", anchor: 150, lightness: 0.62 },
  { id: "dusk", name: "Dusk", anchor: 325, lightness: 0.7 },
  { id: "sand", name: "Sand", anchor: 82, lightness: 0.84 },
  { id: "arctic", name: "Arctic", anchor: 200, lightness: 0.76 },
];

const stop = (l: number, c: number, h: number) =>
  formatHex(clampChroma({ mode: "oklch", l, c, h: ((h % 360) + 360) % 360 }, "oklch"));

export const BACKGROUNDS: readonly Background[] = [
  ...BACKDROPS.map(({ id, name, anchor, lightness }) => ({
    id,
    name,
    angle: 135,
    stops: [
      stop(lightness + FALL / 2, CHROMA, anchor - SWEEP / 2),
      stop(lightness - FALL / 2, CHROMA, anchor + SWEEP / 2),
    ],
  })),
  // The two neutrals have no hue to place on the wheel, so they are spread on
  // lightness instead — far enough apart that neither collides with the other
  // nor with Midnight, which desaturates toward neutral on the muted themes.
  // Graphite's chroma stays under the threshold `themedBackground` treats as a
  // neutral ramp, so it follows the theme's lightness without taking on colour.
  { id: "graphite", name: "Graphite", angle: 135, stops: [stop(0.4, 0.02, 265), stop(0.2, 0.02, 265)] },
  { id: "ink", name: "Ink", angle: 0, stops: [stop(0.16, 0.01, 265), stop(0.16, 0.01, 265)] },
];

export const DEFAULT_BACKGROUND_ID = "midnight";

/**
 * A backdrop id that *is* a colour — `#ff6600`, `#f60` — is a flat fill someone
 * picked, rather than one of the backdrops above.
 *
 * Putting the colour in the id is what makes this cost nothing everywhere an id
 * already travels: the stored workspace, the share link and the picker all name
 * a backdrop by string, and none of them needed a second field. It is also the
 * reason a fill is the one backdrop `themedBackground` leaves alone — the named
 * ones are *roles* the theme re-derives, and a colour someone chose is not a
 * role. Picking `#ff6600` means the image contains `#ff6600`.
 *
 * The pattern is the hex half of `isColor` in core/types.ts and has to stay that
 * way: a backdrop ends up in a PNG rather than in an escape sequence, but the
 * picker writes one syntax and both doors should accept the same one.
 */
const FILL_ID = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isFillId(id: string): boolean {
  return FILL_ID.test(id);
}

/**
 * A fill id in its one canonical spelling: lowercase, six digits. `#F60` and
 * `#ff6600` are one choice, and two spellings of it would light two swatches in
 * the picker — and the platform colour input only accepts the long form, so a
 * hand-written `#f60` in a link would open the picker on black.
 */
export function normalizeFillId(id: string): string {
  const hex = id.slice(1).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex}`;
}

/**
 * The backdrop a fill id names: one stop, because a fill is one colour. Both
 * exporters already handle a single-stop ramp, and `flatColor` below is what
 * keeps them from having to — a flat fill is drawn as a flat fill.
 */
export function fillBackground(color: string): Background {
  return { id: color, name: color, angle: 0, stops: [color] };
}

/** The single colour this backdrop is drawn in, or `null` if it is a ramp. */
export function flatColor(background: Background): string | null {
  return background.stops.length === 1 ? background.stops[0]! : null;
}

export function backgroundById(id: string): Background | null {
  if (isFillId(id)) return fillBackground(id);
  return BACKGROUNDS.find((background) => background.id === id) ?? null;
}

export function backgroundCss(background: Background | null): string {
  if (!background) return "transparent";
  const flat = flatColor(background);
  // Not a one-stop `linear-gradient()`: CSS requires two, and a browser drops
  // the whole declaration rather than the surplus — the preview would lose its
  // backdrop while both exporters kept theirs.
  if (flat) return flat;
  return `linear-gradient(${background.angle}deg, ${background.stops.join(", ")})`;
}

/**
 * The gradient line for a CSS angle, in canvas coordinates. CSS measures from
 * "up" and turns clockwise, and the line is sized so the gradient reaches the
 * corners exactly — the same geometry a browser uses.
 */
export function gradientEndpoints(
  angle: number,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x0: cx - (dx * length) / 2,
    y0: cy - (dy * length) / 2,
    x1: cx + (dx * length) / 2,
    y1: cy + (dy * length) / 2,
  };
}
