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
 * natural luminance, which is the tempting rule and the wrong one. Because
 * `themedBackground` snaps every stop onto the nearest theme accent, two
 * backdrops with neighbouring anchors can land on the same pair — and if they
 * also share a lightness they render as the same swatch. Following natural
 * luminance bunched Mint, Arctic and Sand together at the light end and did
 * exactly that: on Dracula, Mint and Arctic came out an OKLab distance of 0.044
 * apart, two identical-looking options in the picker. Alternating pulls the
 * closest pair anywhere out to 0.140, which `background.test.ts` holds the line on.
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

export function backgroundById(id: string): Background | null {
  return BACKGROUNDS.find((background) => background.id === id) ?? null;
}

export function backgroundCss(background: Background | null): string {
  if (!background) return "transparent";
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
