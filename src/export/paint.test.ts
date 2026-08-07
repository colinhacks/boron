import { describe, expect, it } from "vitest";
import type { ResolvedStyle } from "../core/style.ts";
import { themeById } from "../core/themes.ts";
import { BACKGROUNDS, backgroundById } from "./background.ts";
import { DEFAULT_FRAME, type FrameSettings, type LaidSpan, type Layout } from "./layout.ts";
import { buildOps, isGradient, textOps, type Op } from "./paint.ts";
import type { Scene } from "./scene.ts";

/**
 * `computeLayout` needs a canvas to measure with and jsdom has none, so the
 * layout is written out by hand. That is the point of the display list: what the
 * renderers do with a `Layout` is now testable without one being measured.
 */
function style(overrides: Partial<ResolvedStyle> = {}): ResolvedStyle {
  return {
    color: "#ffffff",
    background: null,
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    opacity: 1,
    ...overrides,
  };
}

function span(text: string, x: number, overrides: Partial<ResolvedStyle> = {}): LaidSpan {
  return { text, x, width: text.length * 9, style: style(overrides) };
}

function layoutWith(spans: LaidSpan[], chromeHeight = 40): Layout {
  return {
    lines: [{ top: 100, baseline: 112, spans }],
    fontSize: 15,
    lineHeight: 23,
    charWidth: 9,
    chromeHeight,
    widest: 200,
    wrapWidth: 404,
    halfLeading: 4,
    terminal: { x: 48, y: 48, width: 500, height: 200 },
    width: 596,
    height: 296,
  };
}

function scene(spans: LaidSpan[], frame: Partial<FrameSettings> = {}, background = null as Scene["background"]): Scene {
  const merged = { ...DEFAULT_FRAME, ...frame };
  return { layout: layoutWith(spans, merged.showChrome ? 40 : 0), frame: merged, theme: themeById("boron"), background };
}

/** The ops inside the clip group — chrome and body. */
function clipped(ops: Op[]): Op[] {
  const clip = ops.find((op) => op.op === "clip");
  return clip?.op === "clip" ? clip.children : [];
}

describe("buildOps", () => {
  it("lays the scene down back to front", () => {
    const ops = buildOps(scene([span("x", 24)], {}, BACKGROUNDS[0]!));
    expect(ops.map((op) => op.op)).toEqual(["fill", "panel", "clip"]);
  });

  it("puts an opaque backdrop beneath the gradient, for the formats with no alpha", () => {
    const ops = buildOps(scene([span("x", 24)], {}, BACKGROUNDS[0]!), "#123456");
    expect(ops[0]).toMatchObject({ op: "fill", x: 0, y: 0, paint: "#123456" });
    expect(ops[1]?.op === "fill" && isGradient(ops[1].paint)).toBe(true);
  });

  it("omits the backdrop entirely when there is none", () => {
    expect(buildOps(scene([span("x", 24)])).map((op) => op.op)).toEqual(["panel", "clip"]);
  });

  it("hangs the shadow off the panel, and drops it at zero strength", () => {
    const withShadow = buildOps(scene([span("x", 24)], { shadowStrength: 100 }))[0];
    expect(withShadow).toMatchObject({ op: "panel", shadow: { offsetY: 18, stdDeviation: 20, opacity: 0.45 } });
    expect(buildOps(scene([span("x", 24)], { shadowStrength: 0 }))[0]).toMatchObject({ shadow: null });
  });

  it("draws the chrome border as the bar's last pixel", () => {
    const [border] = clipped(buildOps(scene([span("x", 24)], { showChrome: true })));
    // terminal.y (48) + chromeHeight (40) - 1
    expect(border).toMatchObject({ op: "fill", x: 48, y: 87, width: 500, height: 1 });
  });

  it("drops the whole chrome when it is off, title and all", () => {
    const ops = clipped(buildOps(scene([span("x", 24)], { showChrome: false, title: "ignored" })));
    expect(ops.some((op) => op.op === "circle")).toBe(false);
    expect(ops.filter((op) => op.op === "text")).toHaveLength(1);
  });

  it("centres the title and leaves body text on its baseline", () => {
    const ops = clipped(buildOps(scene([span("hi", 24)], { showChrome: true, title: "zsh" })));
    const texts = ops.filter((op) => op.op === "text");
    expect(texts[0]).toMatchObject({ text: "zsh", centered: true, y: 68 });
    expect(texts[1]).toMatchObject({ text: "hi", centered: false, x: 72, y: 160 });
  });

  /**
   * Every background on the line is laid down before any glyph on it, so a
   * filled run sits under its neighbour's descenders rather than over them.
   * Interleaving the two passes is the kind of change that looks harmless.
   */
  it("paints every background before any text on the line", () => {
    const ops = clipped(
      buildOps(scene([span("a", 24, { background: "#ff0000" }), span("b", 33, { background: "#00ff00" })], { showChrome: false })),
    );
    expect(ops.map((op) => op.op)).toEqual(["fill", "fill", "text", "text"]);
    // terminal.y (48) + line.top (100), a full line-height tall.
    expect(ops[0]).toMatchObject({ paint: "#ff0000", y: 148, height: 23 });
    expect(ops[1]).toMatchObject({ paint: "#00ff00" });
  });

  it("puts the underline below the baseline and the strikethrough above it", () => {
    const ops = clipped(
      buildOps(scene([span("mid", 24, { underline: true, strikethrough: true, color: "#abcdef" })], { showChrome: false })),
    );
    expect(ops.map((op) => op.op)).toEqual(["text", "fill", "fill"]);
    // baseline 112 + terminal.y 48 = 160; fontSize 15.
    expect(ops[1]).toMatchObject({ op: "fill", y: 160 + 15 * 0.14, height: 1, paint: "#abcdef" });
    expect(ops[2]).toMatchObject({ op: "fill", y: 160 - 15 * 0.28, height: 1, paint: "#abcdef" });
  });

  /**
   * SGR 8 conceals the characters, not the cell — so a hidden run keeps its
   * background and loses its glyphs. The editor currently hides both; this pins
   * what the exporters do so the two can be reconciled deliberately.
   */
  it("keeps a hidden run's background and drops its text", () => {
    const ops = clipped(
      buildOps(scene([span("secret", 24, { opacity: 0, background: "#333333" })], { showChrome: false })),
    );
    expect(ops.map((op) => op.op)).toEqual(["fill"]);
    expect(ops[0]).toMatchObject({ paint: "#333333" });
  });

  it("carries the gradient as geometry rather than as CSS", () => {
    const ops = buildOps(scene([span("x", 24)], {}, BACKGROUNDS[0]!));
    const paint = ops[0]?.op === "fill" ? ops[0].paint : null;
    expect(paint && isGradient(paint)).toBe(true);
    if (paint && isGradient(paint)) {
      expect(paint.stops).toEqual(BACKGROUNDS[0]!.stops);
      expect(Number.isFinite(paint.x0 + paint.y0 + paint.x1 + paint.y1)).toBe(true);
    }
  });

  /**
   * A picked colour is one colour. Carrying it as a ramp would have the SVG emit
   * a `<linearGradient>` with a single stop and a gradient line computed off an
   * angle nobody set — geometry standing in for `fill="#ff6600"`.
   */
  it("carries a fill as a flat colour rather than as a one-stop ramp", () => {
    const ops = buildOps(scene([span("x", 24)], {}, backgroundById("#ff6600")));
    expect(ops[0]).toMatchObject({ op: "fill", x: 0, y: 0, width: 596, height: 296, paint: "#ff6600" });
  });

  /**
   * JPEG has no alpha, so the theme's background goes down first to keep a
   * transparent frame from encoding as black. A fill is a flat paint like that
   * one, and two flat fills of the same rectangle are decided by order alone —
   * so the ordering is the whole of what makes the picked colour the one you see.
   */
  it("lays a fill over the opaque backdrop the alpha-less formats need", () => {
    const ops = buildOps(scene([span("x", 24)], {}, backgroundById("#ff6600")), "#123456");
    expect(ops.slice(0, 2)).toMatchObject([
      { op: "fill", x: 0, y: 0, paint: "#123456" },
      { op: "fill", x: 0, y: 0, paint: "#ff6600" },
    ]);
  });
});

describe("textOps", () => {
  it("reaches the glyphs nested inside the clip group", () => {
    const ops = buildOps(scene([span("hello", 24), span("world", 69)]));
    // Every text op in this scene is inside the clip, so a flattener that only
    // walked the top level would report none at all.
    expect(ops.some((op) => op.op === "text")).toBe(false);
    expect(textOps(ops).map((op) => op.text)).toEqual(["hello", "world"]);
  });

  it("includes the window title, which is drawn from the frame and not the document", () => {
    const ops = textOps(buildOps(scene([span("body", 24)], { showChrome: true, title: "zsh — boron" })));
    expect(ops.map((op) => op.text)).toContain("zsh — boron");
  });

  it("carries the weight and style each run is drawn at", () => {
    const ops = textOps(buildOps(scene([span("b", 24, { bold: true }), span("i", 33, { italic: true })])));
    expect(ops.filter((op) => op.bold).map((op) => op.text)).toEqual(["b"]);
    expect(ops.filter((op) => op.italic).map((op) => op.text)).toEqual(["i"]);
  });
});
