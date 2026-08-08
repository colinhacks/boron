import { describe, expect, it } from "vitest";
import { ASPECT_PRESETS, aspectById, fitToCanvas } from "./layout.ts";

const OG = aspectById("og")!;

// 7.5% of the 630px short side. Spelled out rather than recomputed from the
// ratio, so a change to the constant fails here instead of quietly agreeing.
const MARGIN = 47.25;

describe("aspectById", () => {
  it("resolves the presets by id", () => {
    expect(aspectById("og")).toEqual({ id: "og", label: "1.91:1", width: 1200, height: 630 });
    expect(aspectById("square")?.width).toBe(1080);
    expect(aspectById("wide")?.height).toBe(1080);
  });

  it("reads an unknown id as no aspect at all", () => {
    // Falling back to a *different* preset would crop the picture to a canvas
    // nobody asked for; free-sized is the only safe default.
    expect(aspectById("instagram-story")).toBeNull();
    expect(aspectById(null)).toBeNull();
  });

  it("only offers canvases whose sizes are the ones the specs name", () => {
    expect(ASPECT_PRESETS.map((preset) => `${preset.width}x${preset.height}`)).toEqual([
      "1200x630",
      "1080x1080",
      "1920x1080",
    ]);
  });
});

describe("fitToCanvas", () => {
  it("fills the width when the block is the wider one, and centres the rest", () => {
    const fit = fitToCanvas(2211, 200, OG);
    expect(fit.scale).toBeCloseTo(0.5, 10);
    expect(fit.x).toBeCloseTo(MARGIN, 10);
    expect(fit.y).toBeCloseTo((630 - 100) / 2, 10);
  });

  it("fills the height when the block is the taller one", () => {
    const fit = fitToCanvas(200, 1071, OG);
    expect(fit.scale).toBeCloseTo(535.5 / 1071, 10);
    expect(fit.y).toBeCloseTo(MARGIN, 10);
    expect(fit.x).toBeCloseTo((1200 - 100) / 2, 10);
  });

  it("enlarges a block smaller than the canvas rather than floating it in the middle", () => {
    // The deliberate part: a six-line paste on an Open Graph card would
    // otherwise sit at a tenth of the width in a lake of gradient.
    const fit = fitToCanvas(100, 50, OG);
    expect(fit.scale).toBeGreaterThan(1);
    expect(fit.scale).toBeCloseTo(535.5 / 50, 10);
  });

  it("shrinks a block bigger than the canvas, which is what costs the fixed 15px", () => {
    const fit = fitToCanvas(4000, 3000, OG);
    expect(fit.scale).toBeLessThan(1);
    expect(3000 * fit.scale).toBeCloseTo(535.5, 10);
  });

  it("never lets the block touch an edge, whatever shape it is", () => {
    for (const preset of ASPECT_PRESETS) {
      for (const [width, height] of [
        [10, 10],
        [4000, 20],
        [20, 4000],
        [1200, 630],
      ]) {
        const fit = fitToCanvas(width!, height!, preset);
        const margin = Math.min(preset.width, preset.height) * 0.075;
        expect(fit.x).toBeGreaterThanOrEqual(margin - 1e-9);
        expect(fit.y).toBeGreaterThanOrEqual(margin - 1e-9);
        // Centred, so the far edge clears by exactly as much as the near one.
        expect(fit.x + width! * fit.scale).toBeCloseTo(preset.width - fit.x, 9);
        expect(fit.y + height! * fit.scale).toBeCloseTo(preset.height - fit.y, 9);
      }
    }
  });
});
