import { describe, expect, it } from "vitest";
import { converter, differenceEuclidean, modeOklab, modeOklch, modeRgb, useMode } from "culori/fn";
import { THEMES } from "../core/themes.ts";
import { BACKGROUNDS, backgroundById, backgroundCss, flatColor, isFillId } from "./background.ts";
import { themedBackground } from "./backdrop.ts";

useMode(modeRgb);
useMode(modeOklch);
useMode(modeOklab);
const oklch = converter("oklch");
const distance = differenceEuclidean("oklab");

/** Mean perceptual distance between two gradients, stop for stop. */
function gap(a: readonly string[], b: readonly string[]): number {
  return a.reduce((sum, stop, index) => sum + distance(stop, b[index]!), 0) / a.length;
}

const hue = (stop: string) => oklch(stop)!.h ?? 0;
const CHROMATIC = BACKGROUNDS.filter((background) => oklch(background.stops[0]!)!.c > 0.08);

describe("the backdrop set", () => {
  it("keeps the ids the stored workspaces and share links refer to", () => {
    expect(BACKGROUNDS.map((background) => background.id)).toEqual([
      "midnight",
      "ember",
      "mint",
      "dusk",
      "sand",
      "arctic",
      "graphite",
      "ink",
    ]);
  });

  it("reads a colour as a backdrop of its own, without adding one to the set", () => {
    const fill = backgroundById("#ff6600")!;
    expect(fill.stops).toEqual(["#ff6600"]);
    // The picker lists `BACKGROUNDS`, and a fill is picked rather than listed.
    expect(BACKGROUNDS.some((background) => background.id === fill.id)).toBe(false);
    expect(isFillId("#ff6600")).toBe(true);
    expect(isFillId("midnight")).toBe(false);
    expect(isFillId("none")).toBe(false);
  });

  /**
   * A one-stop `linear-gradient()` is not a CSS gradient — the browser drops the
   * whole declaration rather than the surplus, so the preview would lose its
   * backdrop while both exporters kept theirs. Three renderers have to agree.
   */
  it("writes a fill as a flat colour rather than as a gradient", () => {
    expect(backgroundCss(backgroundById("#ff6600"))).toBe("#ff6600");
    expect(flatColor(backgroundById("#ff6600")!)).toBe("#ff6600");
    expect(backgroundCss(backgroundById("midnight"))).toContain("linear-gradient(");
    expect(flatColor(backgroundById("midnight")!)).toBeNull();
    expect(backgroundCss(null)).toBe("transparent");
  });

  it("spreads the coloured backdrops around the hue wheel", () => {
    const anchors = CHROMATIC.map((background) => hue(background.stops[0]!)).sort((a, b) => a - b);
    const gaps = anchors.map((h, i) => (i === 0 ? h + 360 - anchors.at(-1)! : h - anchors[i - 1]!));
    // The set they replaced had six of eight endpoints inside a single 100°
    // band. Nothing should now sit closer than 35° to its neighbour.
    for (const g of gaps) expect(g).toBeGreaterThan(35);
  });

  it("gives every gradient the same sweep", () => {
    const sweeps = CHROMATIC.map((background) =>
      Math.abs(hue(background.stops.at(-1)!) - hue(background.stops[0]!)),
    );
    for (const sweep of sweeps) expect(Math.abs(sweep - sweeps[0]!)).toBeLessThan(2);
  });

  it("has a green that is actually green", () => {
    // "Mint" used to start at 163°, which is teal. Green is roughly 120-165.
    const mint = backgroundById("mint")!;
    expect(hue(mint.stops[0]!)).toBeGreaterThan(115);
    expect(hue(mint.stops[0]!)).toBeLessThan(150);
  });

  /**
   * The one that actually bites. An earlier adapter chose each gradient's hues
   * independently, and on a palette with few hues in a region two backdrops
   * chose the same pair — Mint and Arctic once landed 0.044 apart on Dracula,
   * two indistinguishable options in the picker. The arc system makes a hue
   * collision impossible by construction; this holds the perceptual floor under
   * every pair, the two neutrals included, at their measured 0.140 less margin.
   */
  it("renders every backdrop distinctly on every theme", () => {
    for (const theme of THEMES) {
      const rendered = BACKGROUNDS.map((background) => ({
        id: background.id,
        stops: themedBackground(background, theme)!.stops,
      }));
      for (let i = 0; i < rendered.length; i++) {
        for (let j = i + 1; j < rendered.length; j++) {
          expect(
            gap(rendered[i]!.stops, rendered[j]!.stops),
            `${rendered[i]!.id} and ${rendered[j]!.id} on ${theme.id}`,
          ).toBeGreaterThan(0.13);
        }
      }
    }
  });
});
