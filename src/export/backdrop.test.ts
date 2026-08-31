import { describe, expect, it } from "vitest";
import { oklch } from "culori";
import { THEMES, themeById } from "../core/themes.ts";
import { BACKGROUNDS, backgroundById } from "./background.ts";
import { themedBackground } from "./backdrop.ts";

const nord = themeById("nord");
const vscode = themeById("vscode");
const ember = backgroundById("ember")!;

/** Total hue travelled along a gradient, in degrees. */
function hueSpan(stops: readonly string[]): number {
  const hues = stops.map((stop) => oklch(stop)!.h ?? 0);
  return hues
    .slice(1)
    .reduce((sum, hue, index) => sum + Math.abs(((((hue - hues[index]!) % 360) + 540) % 360) - 180), 0);
}

/** Matches the whole-gradient rule `themedBackground` uses to spot a neutral. */
const isNeutral = (stops: readonly string[]) => Math.max(...stops.map((s) => oklch(s)!.c)) < 0.08;

const medianChroma = (stops: readonly string[]) =>
  [...stops.map((stop) => oklch(stop)!.c)].sort((a, b) => a - b)[Math.floor(stops.length / 2)]!;

describe("themedBackground", () => {
  it("keeps the backdrop's identity — only the stops move", () => {
    const themed = themedBackground(ember, nord)!;
    expect(themed.id).toBe("ember");
    expect(themed.name).toBe("Ember");
    expect(themed.angle).toBe(ember.angle);
    expect(themed.stops).toHaveLength(ember.stops.length);
    expect(themed.stops).not.toEqual(ember.stops);
  });

  it("leaves a transparent frame alone", () => {
    expect(themedBackground(null, nord)).toBeNull();
  });

  /**
   * The eight named backdrops are roles the theme re-derives; a colour somebody
   * picked is not a role, it is the answer. Adapting it would paint a different
   * colour than the picker is showing — and a different one again per theme.
   */
  it("hands back a picked fill colour untouched, on every theme", () => {
    const fill = backgroundById("#ff6600")!;
    for (const theme of THEMES) expect(themedBackground(fill, theme)).toEqual(fill);
  });

  it("is pure in the backdrop and the theme", () => {
    expect(themedBackground(ember, nord)).toEqual(themedBackground(ember, nord));
  });

  /**
   * Two arc assignments can score identically, and before the tie-break was
   * made explicit the winner came down to the order the candidates happened to
   * be generated in — which differed between Node and the browser. A backdrop
   * that resolves one way in the preview and another in the exported PNG is
   * worse than either resolution, so these are pinned rather than merely
   * asserted to be self-consistent.
   */
  it("settles ties the same way everywhere", () => {
    expect(themedBackground(backgroundById("midnight")!, nord)!.stops).toEqual(["#3c6e9e", "#543b72"]);
    expect(themedBackground(ember, nord)!.stops).toEqual(["#c0757b", "#8d6026"]);
  });

  it("runs a muted theme's backdrop less saturated than a vivid one's", () => {
    // Nord's accents sit at roughly half VS Code's chroma, which is the whole
    // reason a fixed Ember looked like someone else's wallpaper behind it.
    expect(medianChroma(themedBackground(ember, nord)!.stops)).toBeLessThan(
      medianChroma(themedBackground(ember, vscode)!.stops),
    );
  });

  /**
   * The failure this guards is *compression* — a gradient too narrow to read as
   * a gradient, which is what looked muddy rather than adapted. The first
   * adapter could crowd both stops onto one accent's neighbourhood; the arc
   * system floors the sweep structurally instead: accents that survive the
   * hue-family fold are at least 24° apart, so every arc — and every gradient
   * living in one — is at least that wide. The bound sits under the fold width
   * only because a hex round-trip nudges hues by a degree or two.
   *
   * The ceiling is the authored sweep itself: a window never travels farther
   * than the gradient it re-derives, so a backdrop cannot smear across half the
   * wheel on a sparsely-hued palette.
   */
  it("keeps every gradient's hue sweep between the family floor and its authored width", () => {
    for (const background of BACKGROUNDS) {
      // Graphite and Ink carry no hue to preserve — `themedBackground` holds
      // them neutral on purpose, and "leaves the neutral backdrops neutral"
      // below is what covers them.
      if (isNeutral(background.stops)) continue;
      const original = hueSpan(background.stops);
      for (const theme of THEMES) {
        const sweep = hueSpan(themedBackground(background, theme)!.stops);
        expect(sweep, `${background.id} on ${theme.id}: ${original.toFixed(0)}° became ${sweep.toFixed(0)}°`).toBeGreaterThan(20);
        expect(sweep, `${background.id} on ${theme.id}: ${original.toFixed(0)}° became ${sweep.toFixed(0)}°`).toBeLessThan(original + 5);
      }
    }
  });

  /**
   * The complaint that forced the arc system: Mint and Arctic both rendered
   * green-to-cyan on Boron and Dracula, distinguishable only by lightness — two
   * options in the picker that were one option shown twice. Distinct arcs make
   * hue collision impossible by construction; this holds the perceptual margin
   * that construction is supposed to buy, on every pair, on every theme.
   */
  it("never gives two backdrops the same hues on any theme", () => {
    const chromatic = BACKGROUNDS.filter((background) => !isNeutral(background.stops));
    const hue = (stop: string) => oklch(stop)!.h ?? 0;
    for (const theme of THEMES) {
      const themed = chromatic.map((background) => themedBackground(background, theme)!);
      for (let i = 0; i < themed.length; i++) {
        for (let j = i + 1; j < themed.length; j++) {
          const apart = Math.max(
            ...themed[i]!.stops.map((stop, index) => {
              const delta = hue(themed[j]!.stops[index]!) - hue(stop);
              return Math.abs(((((delta % 360) + 540) % 360) - 180));
            }),
          );
          expect(apart, `${themed[i]!.id} and ${themed[j]!.id} on ${theme.id}`).toBeGreaterThan(30);
        }
      }
    }
  });

  /**
   * Graphite is the neutral backdrop and has to stay neutral. Its two greys sit
   * just over the per-stop chroma line, so before the whole-gradient check each
   * end was handed a different theme accent and it grew a hue sweep of its own.
   */
  it("leaves the neutral backdrops neutral", () => {
    for (const id of ["graphite", "ink"]) {
      const background = backgroundById(id)!;
      for (const theme of THEMES) {
        const themed = themedBackground(background, theme)!;
        expect(hueSpan(themed.stops), `${id} on ${theme.id}`).toBeLessThan(hueSpan(background.stops) + 6);
        for (const stop of themed.stops) {
          expect(oklch(stop)!.c, `${id} on ${theme.id}`).toBeLessThan(0.06);
        }
      }
    }
  });
});
