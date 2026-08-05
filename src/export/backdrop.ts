import { clampChroma, converter, formatHex, modeOklch, modeRgb, useMode } from "culori/fn";
import { THEMES, type Theme } from "../core/themes.ts";
import type { Background } from "./background.ts";

// Imported from `culori/fn` rather than `culori`, which registers every colour
// space the library ships and costs more in the bundle than this whole file.
// Registering means only sRGB, to read the hex in, and OKLCH to work in.
useMode(modeRgb);
useMode(modeOklch);
const oklch = converter("oklch");

/**
 * Backdrops adapted to the theme in front of them.
 *
 * The eight backdrops used to be fixed hex stops, which meant one gradient had
 * to sit behind eight palettes of wildly different character. Against a muted
 * profile like Nord — whose accents run at half the chroma of VS Code's — a
 * fully saturated Ember read as someone else's wallpaper behind the block.
 *
 * So a backdrop is a *role* rather than a fixed appearance: Ember is "the warm
 * one", and what warm means is re-derived from whichever palette is selected.
 * Every stop is rebuilt out of the theme's own accent hues, which is what makes
 * the backdrop and the text on the block look like they came from one place.
 *
 * All of it happens in OKLCH, so "half as saturated" and "a little lighter" are
 * perceptual moves rather than arithmetic on hex that lands somewhere else.
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
 * 0.039 — over the per-stop line, so each end was being handed a *different*
 * theme accent and the neutral backdrop quietly acquired a hue sweep. Every
 * backdrop that is actually about its colour starts at 0.11, so the gap is wide.
 */
const NEUTRAL_GRADIENT = 0.08;

/** Two accents closer than this are the same hue as far as a gradient cares. */
const SAME_HUE = 12;

/**
 * How hard the stop selection fights to keep the gradient's original sweep,
 * against how near each stop lands to where it started.
 *
 * At zero each stop simply takes its own nearest accent, which quietly halves
 * the sweep — Ember's 47° of hue travel came out at 23° on Nord, and that
 * flattening is what made the result look muddy rather than adapted. At 2 the
 * spans come back within a few degrees of the original and the choice stops
 * moving; 3 picks the same stops as 2.
 */
const SPAN_WEIGHT = 2;

/**
 * How far a backdrop follows its theme's own lightness. Holding the gap between
 * block and backdrop exactly constant (1) drove the paler themes to pastel and
 * cost the block the contrast it was standing out on.
 */
const LIGHTNESS_TRACKING = 0.45;

/**
 * Scores are compared with a tolerance rather than exactly, because two
 * selections that are the same choice on paper can land a float apart.
 */
const EPSILON = 1e-9;

/** Shortest signed angle from `a` to `b`, in degrees. */
function hueDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
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
 * Hues are rounded before anything compares them, so that neither the fold
 * below nor a tie above can turn on a difference too small to see.
 */
function quantize(hue: number): number {
  return Math.round(hue * 100) / 100;
}

/** Total hue travelled along a run of stops — Ember's warm-to-pink sweep. */
function hueSpan(hues: readonly number[]): number {
  return hues.slice(1).reduce((sum, hue, index) => sum + Math.abs(hueDelta(hues[index]!, hue)), 0);
}

function median(values: readonly number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

interface Character {
  /** Median chroma of the theme's accents — how saturated it runs. */
  chroma: number;
  /** Its accent hues, with near-duplicates folded together. */
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
    if (!hues.some((seen) => Math.abs(hueDelta(hue, seen)) < SAME_HUE)) hues.push(hue);
  }
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

/** Every ordered selection of `length` distinct values. */
function permutations<T>(values: readonly T[], length: number): T[][] {
  if (length === 0) return [[]];
  const out: T[][] = [];
  values.forEach((value, index) => {
    const rest = values.filter((_, other) => other !== index);
    for (const tail of permutations(rest, length - 1)) out.push([value, ...tail]);
  });
  return out;
}

/**
 * The theme accents to build this gradient from, chosen as a *set* rather than
 * one stop at a time: distinct hues, assigned in order, scored on how near each
 * lands to its original and how well the selection preserves the sweep.
 *
 * Picking each stop's nearest accent independently is the obvious thing and the
 * wrong one — both ends of a narrow gradient get pulled toward whichever accent
 * they share a neighbourhood with, and the gradient flattens.
 */
function chooseHues(original: readonly number[], palette: readonly number[]): number[] | null {
  if (!original.length || palette.length < original.length) return null;
  let best: number[] | null = null;
  let bestScore = Infinity;
  for (const candidate of permutations(palette, original.length)) {
    const fit = candidate.reduce((sum, hue, index) => sum + Math.abs(hueDelta(original[index]!, hue)), 0);
    const score = fit + SPAN_WEIGHT * Math.abs(hueSpan(candidate) - hueSpan(original));
    if (score < bestScore - EPSILON) {
      bestScore = score;
      best = candidate;
    } else if (best && score <= bestScore + EPSILON && isEarlier(candidate, best)) {
      // Ties are real and they are common: Midnight's two stops on Nord score
      // identically whether they take 249→217 or 217→249. Broken by the hue
      // sequence itself rather than by whichever the enumeration reached first,
      // because that order is not stable across engines — and a backdrop that
      // resolves differently in the preview, the PNG and a shared link is worse
      // than either choice.
      bestScore = Math.min(bestScore, score);
      best = candidate;
    }
  }
  return best;
}

function adapt(background: Background, theme: Theme): Background {
  const character = characterOf(theme);
  const shift = (character.backgroundLightness - REFERENCE.backgroundLightness) * LIGHTNESS_TRACKING;
  const ceiling = Math.max(character.chroma, REFERENCE.chroma * 0.35) * 1.25;

  const source = background.stops.map((stop) => oklch(stop));
  const neutral = Math.max(...source.map((color) => color?.c ?? 0)) < NEUTRAL_GRADIENT;
  const chromatic = source.filter((color) => color !== undefined && color.c >= ACHROMATIC && color.h !== undefined);
  const chosen = neutral
    ? null
    : chooseHues(
        chromatic.map((color) => quantize(color!.h!)),
        character.hues,
      );

  let next = 0;
  const stops = source.map((color, index) => {
    if (!color) return background.stops[index]!;
    const l = Math.max(0.05, Math.min(0.95, color.l + shift));
    // Greys and near-greys — Graphite, Ink — have no hue to re-derive, so they
    // only follow the theme's lightness.
    if (!chosen || color.c < ACHROMATIC || color.h === undefined) {
      return formatHex(clampChroma({ ...color, l }, "oklch"));
    }
    return formatHex(
      clampChroma({ mode: "oklch", l, c: Math.min(color.c, ceiling), h: chosen[next++]! }, "oklch"),
    );
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
  const key = `${background.id}:${theme.id}`;
  let result = adapted.get(key);
  if (!result) {
    result = adapt(background, theme);
    adapted.set(key, result);
  }
  return result;
}
