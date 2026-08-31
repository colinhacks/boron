import { clampChroma, converter, formatHex, modeOklch, modeRgb, useMode } from "culori/fn";
import { THEMES, type Theme } from "../core/themes.ts";
import { BACKGROUNDS, isFillId, type Background } from "./background.ts";

// Imported from `culori/fn` rather than `culori`, which registers every colour
// space the library ships and costs more in the bundle than this whole file.
// Registering means only sRGB, to read the hex in, and OKLCH to work in.
useMode(modeRgb);
useMode(modeOklch);
const oklch = converter("oklch");

/**
 * Backdrops adapted to the theme in front of them.
 *
 * A backdrop is a *role* rather than a fixed appearance: Ember is "the warm
 * one", and what warm means is re-derived from whichever palette is selected.
 * That much survived from the first version of this file. What changed is *how*
 * the hues are re-derived.
 *
 * The first version snapped each stop to its nearest theme accent, one gradient
 * at a time — and a per-gradient choice cannot see the other seven. On a palette
 * with only two hues in a region, two neighbouring backdrops chose the same
 * pair: Mint and Arctic both came out green-to-cyan on Boron and Dracula,
 * distinguishable only by lightness. Two swatches in the picker read as one
 * option shown twice.
 *
 * So the hues are now allocated jointly, from a construction that cannot
 * collide. The theme's accent hues, folded into families and sorted, divide the
 * hue wheel into arcs — one arc between each pair of neighbouring accents. The
 * six chromatic backdrops take six *distinct* arcs, matched to their authored
 * anchors in circular order, and each gradient sweeps a window inside its own
 * arc. Distinct arcs are disjoint, so no two backdrops can render the same hue
 * pair on any palette — the guarantee is structural rather than a tuned
 * constant, and `background.test.ts` holds the perceptual line on top of it.
 *
 * Everything happens in OKLCH, so "half as saturated" and "a little lighter"
 * are perceptual moves rather than arithmetic on hex that lands somewhere else.
 */

/**
 * The ANSI slots that carry a hue. 0, 7, 8 and 15 are the greys at either end
 * of the palette; averaging them in drags every theme's chroma toward zero and
 * flattens exactly the differences this is trying to measure.
 */
const CHROMATIC_SLOTS = [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14];

/** Below this a color has no meaningful hue, so it is left alone. */
const ACHROMATIC = 0.03;

/**
 * Peak chroma below which a whole gradient counts as a neutral ramp and keeps
 * its own hues, following only the theme's lightness.
 *
 * Judged per gradient rather than per stop, because Graphite's two greys sit at
 * 0.039 — over the per-stop line — and Sand's light end clamps *under* it while
 * the gradient as a whole is plainly a colour. Every backdrop that is actually
 * about its colour peaks well above this; Graphite peaks at 0.039.
 */
const NEUTRAL_GRADIENT = 0.08;

/**
 * Two accents closer than this are one hue family, and only one of them anchors
 * an arc. Dracula's two cyans sit 17° apart; treating them as two accents made
 * an arc so narrow the gradient living in it was effectively flat. Folding at a
 * family width also puts a floor under every arc: neighbouring accents that
 * survive the fold are at least this far apart, so every gradient keeps at
 * least this much sweep.
 */
const HUE_FAMILY = 24;

/**
 * How far a backdrop follows its theme's own lightness. Holding the gap between
 * block and backdrop exactly constant (1) drove the paler themes to pastel and
 * cost the block the contrast it was standing out on.
 */
const LIGHTNESS_TRACKING = 0.45;

/**
 * Scores are compared with a tolerance rather than exactly, because two
 * assignments that are the same choice on paper can land a float apart.
 */
const EPSILON = 1e-9;

/** Shortest signed angle from `a` to `b`, in degrees. */
function hueDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Shortest distance between two hues, in degrees. */
function hueDistance(a: number, b: number): number {
  return Math.abs(hueDelta(a, b));
}

/**
 * A total order on hue sequences, used only to settle ties. Any consistent rule
 * would do; what matters is that it does not depend on the order candidates
 * happen to be generated in.
 */
function isEarlier(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}

/**
 * Hues are rounded before anything compares them, so that neither the fold nor
 * a tie can turn on a difference too small to see.
 */
function quantize(hue: number): number {
  return Math.round(hue * 100) / 100;
}

function median(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

interface Character {
  /** Median chroma of the theme's accents — how saturated it runs. */
  chroma: number;
  /** Its accent hues, folded into families and sorted ascending. */
  hues: number[];
  /** Lightness of the block itself. */
  backgroundLightness: number;
}

function characterize(theme: Theme): Character {
  const accents = CHROMATIC_SLOTS.map((slot) => oklch(theme.ansi[slot]!)).filter(
    (color): color is NonNullable<typeof color> => color !== undefined && color.c > 0.02,
  );
  const hues: number[] = [];
  for (const accent of accents) {
    if (accent.h === undefined) continue;
    const hue = quantize(accent.h);
    if (!hues.some((seen) => hueDistance(hue, seen) < HUE_FAMILY)) hues.push(hue);
  }
  hues.sort((a, b) => a - b);
  return {
    chroma: accents.length ? median(accents.map((accent) => accent.c)) : 0,
    hues,
    backgroundLightness: oklch(theme.background)?.l ?? 0,
  };
}

const characters = new Map<string, Character>();

function characterOf(theme: Theme): Character {
  let character = characters.get(theme.id);
  if (!character) {
    character = characterize(theme);
    characters.set(theme.id, character);
  }
  return character;
}

/**
 * The middle of the pack, so a theme of ordinary saturation and ordinary
 * darkness leaves its backdrop where it already was and only the outliers move.
 */
const REFERENCE = {
  chroma: median(THEMES.map((theme) => characterOf(theme).chroma)),
  backgroundLightness: median(THEMES.map((theme) => characterOf(theme).backgroundLightness)),
};

interface Role {
  id: string;
  /** Hue at the middle of the authored sweep, in degrees. */
  anchor: number;
  /** How much hue the authored gradient travels. */
  sweep: number;
}

/**
 * The chromatic backdrops as roles, read off their authored stops and kept in
 * circular anchor order — the same order the arcs come in, which is what lets
 * the assignment walk both in step.
 */
const ROLES: readonly Role[] = BACKGROUNDS.filter(
  (background) => Math.max(...background.stops.map((stop) => oklch(stop)?.c ?? 0)) >= NEUTRAL_GRADIENT,
)
  .map((background) => {
    const first = oklch(background.stops[0]!)!;
    const last = oklch(background.stops.at(-1)!)!;
    const travel = hueDelta(first.h!, last.h!);
    return {
      id: background.id,
      anchor: quantize((((first.h! + travel / 2) % 360) + 360) % 360),
      sweep: Math.abs(travel),
    };
  })
  .sort((a, b) => a.anchor - b.anchor);

interface Arc {
  /** Hue where the arc begins; it runs clockwise. */
  start: number;
  /** How many degrees it covers. */
  span: number;
}

/**
 * The arcs between neighbouring accents, with the widest gaps split until there
 * are enough for every role. Splitting only ever happens on a palette with
 * fewer hue families than there are chromatic backdrops — none of the shipped
 * themes — but a sparse palette still owes every role its own arc.
 */
function arcsOf(character: Character): Arc[] {
  const hues = [...character.hues];
  while (hues.length > 0 && hues.length < ROLES.length) {
    let widest = 0;
    let widestSpan = -1;
    for (let i = 0; i < hues.length; i++) {
      const span = i + 1 < hues.length ? hues[i + 1]! - hues[i]! : hues[0]! + 360 - hues[i]!;
      if (span > widestSpan + EPSILON) {
        widest = i;
        widestSpan = span;
      }
    }
    hues.push(quantize((hues[widest]! + widestSpan / 2) % 360));
    hues.sort((a, b) => a - b);
  }
  return hues.map((hue, index) => ({
    start: hue,
    span: index + 1 < hues.length ? hues[index + 1]! - hue : hues[0]! + 360 - hue,
  }));
}

interface Window {
  /** Hue at the first stop. */
  from: number;
  /** Signed travel to the last stop; always clockwise. */
  sweep: number;
}

/**
 * Where inside its arc a role's gradient actually sweeps. The arc is the
 * allocation; the window is the part of it the gradient uses, slid toward the
 * role's authored anchor so the name stays true. On Boron the yellow-to-green
 * arc belongs to Sand, whose anchor is gold — the window hugs the yellow end
 * rather than centring on the arc and dragging Sand into lime.
 */
function windowFor(role: Role, arc: Arc): Window {
  const sweep = Math.min(arc.span, role.sweep);
  const low = sweep / 2;
  const high = arc.span - sweep / 2;
  const anchorOffset = (((role.anchor - arc.start) % 360) + 360) % 360;
  let centerOffset: number;
  if (anchorOffset >= low && anchorOffset <= high) {
    centerOffset = anchorOffset;
  } else {
    const toLow = hueDistance(role.anchor, arc.start + low);
    const toHigh = hueDistance(role.anchor, arc.start + high);
    centerOffset = toLow <= toHigh ? low : high;
  }
  const center = arc.start + centerOffset;
  return { from: quantize((((center - sweep / 2) % 360) + 360) % 360), sweep };
}

/**
 * Which arc each chromatic backdrop sweeps on this theme, decided for the set
 * at once: every circular-order-preserving assignment of roles to distinct arcs
 * is scored on how near each window can get to its role's anchor, and the best
 * one wins. Preserving circular order is what keeps the picker reading as one
 * wheel — Mint is never suddenly on the far side of Arctic — and distinctness
 * needs no score at all, because two roles cannot be given the same arc.
 */
function assignmentFor(theme: Theme): Map<string, Window> {
  const arcs = arcsOf(characterOf(theme));
  const assignment = new Map<string, Window>();
  if (arcs.length < ROLES.length) return assignment;
  let best: Window[] | null = null;
  let bestScore = Infinity;
  for (const subset of subsets(arcs.length, ROLES.length)) {
    for (let rotation = 0; rotation < ROLES.length; rotation++) {
      const windows = ROLES.map((role, index) => windowFor(role, arcs[subset[(index + rotation) % ROLES.length]!]!));
      const score = windows.reduce(
        (sum, window, index) => sum + hueDistance(ROLES[index]!.anchor, window.from + window.sweep / 2),
        0,
      );
      const centers = windows.map((window) => quantize(window.from));
      if (
        score < bestScore - EPSILON ||
        (best !== null &&
          score <= bestScore + EPSILON &&
          isEarlier(
            centers,
            best.map((window) => quantize(window.from)),
          ))
      ) {
        // Ties are broken by the hue sequence itself rather than by whichever
        // the enumeration reached first, because that order is not stable
        // across engines — and a backdrop that resolves differently in the
        // preview, the PNG and a shared link is worse than either choice.
        bestScore = Math.min(bestScore, score);
        best = windows;
      }
    }
  }
  for (const [index, role] of ROLES.entries()) assignment.set(role.id, best![index]!);
  return assignment;
}

/** Every `length`-sized selection of indices below `count`, in index order. */
function subsets(count: number, length: number): number[][] {
  const out: number[][] = [];
  const pick = (from: number, acc: number[]) => {
    if (acc.length === length) {
      out.push([...acc]);
      return;
    }
    for (let i = from; i < count; i++) {
      acc.push(i);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

const assignments = new Map<string, Map<string, Window>>();

function assignmentOf(theme: Theme): Map<string, Window> {
  let assignment = assignments.get(theme.id);
  if (!assignment) {
    assignment = assignmentFor(theme);
    assignments.set(theme.id, assignment);
  }
  return assignment;
}

function adapt(background: Background, theme: Theme): Background {
  const character = characterOf(theme);
  const shift = (character.backgroundLightness - REFERENCE.backgroundLightness) * LIGHTNESS_TRACKING;
  const ceiling = Math.max(character.chroma, REFERENCE.chroma * 0.35) * 1.25;

  const source = background.stops.map((stop) => oklch(stop));
  const neutral = Math.max(...source.map((color) => color?.c ?? 0)) < NEUTRAL_GRADIENT;
  const window = neutral ? undefined : assignmentOf(theme).get(background.id);

  const stops = source.map((color, index) => {
    if (!color) return background.stops[index]!;
    const l = Math.max(0.05, Math.min(0.95, color.l + shift));
    // Greys and near-greys — Graphite, Ink — have no hue to re-derive, so they
    // only follow the theme's lightness. So does a stop with no hue of its own,
    // and every backdrop on the one palette too grey to yield any arcs at all.
    if (!window || color.c < ACHROMATIC || color.h === undefined) {
      return formatHex(clampChroma({ ...color, l }, "oklch"));
    }
    const t = source.length === 1 ? 0.5 : index / (source.length - 1);
    const h = (((window.from + window.sweep * t) % 360) + 360) % 360;
    return formatHex(clampChroma({ mode: "oklch", l, c: Math.min(color.c, ceiling), h }, "oklch"));
  });

  return { ...background, stops };
}

const adapted = new Map<string, Background>();

/**
 * The backdrop as it should look in front of `theme`.
 *
 * Pure in `(background.id, theme.id)` — nothing is stored and nothing is read
 * back — so a share link carrying a backdrop id and a theme id still resolves to
 * the same picture on the other side.
 */
export function themedBackground(background: Background | null, theme: Theme): Background | null {
  if (!background) return null;
  // Everything below re-derives a backdrop from the theme's own accents, which
  // is the right answer for the eight named ones and the wrong one for a colour
  // somebody picked by hand. A fill is already the answer — adapting it would
  // hand back a different colour than the picker is showing.
  if (isFillId(background.id)) return background;
  const key = `${background.id}:${theme.id}`;
  let result = adapted.get(key);
  if (!result) {
    result = adapt(background, theme);
    adapted.set(key, result);
  }
  return result;
}
