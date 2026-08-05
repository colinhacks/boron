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

  it("is pure in the backdrop and the theme", () => {
    expect(themedBackground(ember, nord)).toEqual(themedBackground(ember, nord));
  });

  /**
   * Midnight's two stops score identically on Nord whether they take 249°→217°
   * or 217°→249°, so before the tie-break was made explicit the winner came down
   * to the order the candidates happened to be generated in — and that differed
   * between Node and the browser. A backdrop that resolves one way in the
   * preview and another in the exported PNG is worse than either resolution, so
   * these are pinned rather than merely asserted to be self-consistent.
   */
  it("settles ties the same way everywhere", () => {
    expect(themedBackground(backgroundById("midnight")!, nord)!.stops).toEqual(["#007b7a", "#174c79"]);
    expect(themedBackground(ember, nord)!.stops).toEqual(["#c0757b", "#846620"]);
  });

  it("runs a muted theme's backdrop less saturated than a vivid one's", () => {
    // Nord's accents sit at roughly half VS Code's chroma, which is the whole
    // reason a fixed Ember looked like someone else's wallpaper behind it.
    expect(medianChroma(themedBackground(ember, nord)!.stops)).toBeLessThan(
      medianChroma(themedBackground(ember, vscode)!.stops),
    );
  });

  /**
   * The regression that matters, and it is specifically about *compression*.
   * Choosing each stop's nearest accent one at a time pulled both ends of a
   * gradient toward whichever accent they shared a neighbourhood with, and the
   * sweep collapsed — on Nord, Ember's 47° of hue travel came out at 23°, Mint's
   * 58° at 23°. That flattening is what read as muddy rather than adapted.
   *
   * A gradient coming out *wider* than it went in is not that failure and is
   * left alone: Arctic opens from 53° to 89° on Dracula, whose accents are
   * simply spaced that way, and it looks like Arctic.
   */
  it("never flattens a gradient's hue sweep", () => {
    for (const background of BACKGROUNDS) {
      // Graphite and Ink carry no hue to preserve — `themedBackground` holds
      // them neutral on purpose, and "leaves the neutral backdrops neutral"
      // below is what covers them.
      if (isNeutral(background.stops)) continue;
      const original = hueSpan(background.stops);
      for (const theme of THEMES) {
        const themed = themedBackground(background, theme)!;
        const ratio = hueSpan(themed.stops) / original;
        expect(
          ratio,
          `${background.id} on ${theme.id}: ${original.toFixed(0)}° became ${hueSpan(themed.stops).toFixed(0)}°`,
        ).toBeGreaterThan(0.5);
      }
    }
  });

  /** Nord is the palette that prompted all this, so hold it to a tighter bound. */
  it("keeps Nord's sweeps close to the originals", () => {
    for (const background of BACKGROUNDS) {
      if (isNeutral(background.stops)) continue;
      const original = hueSpan(background.stops);
      const ratio = hueSpan(themedBackground(background, nord)!.stops) / original;
      expect(ratio, `${background.id} on nord`).toBeGreaterThan(0.75);
      expect(ratio, `${background.id} on nord`).toBeLessThan(1.35);
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
