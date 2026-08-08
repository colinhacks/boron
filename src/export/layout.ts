import { resolveStyle, type ResolvedStyle } from "../core/style.ts";
import type { Theme } from "../core/themes.ts";
import type { RenderLine } from "../core/types.ts";
import { wrapRenderLines } from "../core/wrap.ts";
import { FONT_FAMILY } from "./fonts.ts";

/**
 * Space between the terminal edge and its text. Fixed rather than tunable: it
 * is the one measurement a real terminal doesn't let you set either, and every
 * value but this one made the block look either cramped or hollow.
 */
export const TERMINAL_PADDING = 24;

/**
 * Type size and line height are fixed. Both were tunable and neither earned it:
 * the block is exported at a scale factor anyway, so font size only changed how
 * much a line could hold, and every line height but this one made the rows read
 * as either cramped or double-spaced.
 */
export const FONT_SIZE = 15;
export const LINE_HEIGHT_RATIO = 1.55;

/**
 * Longest window title the sidebar accepts and a share link carries. The chrome
 * widens to fit the title, so the two limits have to be the same number or a
 * link opens a block of a different width than the one that was shared.
 */
export const MAX_TITLE_LENGTH = 200;

/**
 * The width the controls offer, in columns. The sidebar slider and the drag
 * handles share it so the two cannot disagree about how wide the block may get;
 * `sanitizeFrame` still clamps wider than this, because bytes arrive from places
 * neither control wrote.
 */
export const MIN_COLUMNS = 20;
export const MAX_COLUMNS = 200;

/**
 * A canvas a social card gets cropped to, as an exact pixel size rather than a
 * bare ratio.
 *
 * Every platform accepts an image of any size and scales it, but it *crops* to
 * the ratio — so the ratio is the part that has to be right. The exact sizes are
 * here anyway because they are the ones the specs name, and naming them is what
 * lets the export be a file you can point `og:image` at with nothing in between.
 * 1200×630 covers Open Graph, X's `summary_large_image` and LinkedIn alike.
 */
export interface AspectPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: "og", label: "1.91:1", width: 1200, height: 630 },
  { id: "square", label: "1:1", width: 1080, height: 1080 },
  { id: "wide", label: "16:9", width: 1920, height: 1080 },
];

/** The preset an id names, or `null` for a free-sized image. */
export function aspectById(id: string | null): AspectPreset | null {
  if (id === null) return null;
  return ASPECT_PRESETS.find((candidate) => candidate.id === id) ?? null;
}

/**
 * Breathing room around the block on a fixed canvas, as a fraction of the
 * canvas's short side.
 *
 * Proportional rather than absolute, so a card is composed the same way at 630px
 * tall as at 1080. This is also the reason Padding stops being a control once an
 * aspect is picked: the canvas size is fixed from the outside, so what is left
 * around the block is an output rather than something to set. 7.5% of 630 is
 * 47px, which is a rounding error away from where the Padding slider already
 * sat by default — so a card looks like the free-sized image it replaces.
 */
export const ASPECT_MARGIN_RATIO = 0.075;

export interface FrameSettings {
  /** Space between the terminal and the edge of the image. Ignored under an `aspect`. */
  framePadding: number;
  radius: number;
  showChrome: boolean;
  title: string;
  /** 0-100. Zero casts no shadow at all. */
  shadowStrength: number;
  /** How many characters wide the terminal is. Longer lines wrap, as they would. */
  columns: number;
  /** An `ASPECT_PRESETS` id to pin the canvas to, or `null` to fit the content. */
  aspect: string | null;
}

export const DEFAULT_FRAME: FrameSettings = {
  framePadding: 48,
  radius: 12,
  showChrome: true,
  title: "",
  shadowStrength: 100,
  columns: 80,
  aspect: null,
};

export interface CanvasFit {
  /** What the block is multiplied by to fill the canvas. */
  scale: number;
  /** Where the scaled block's top-left corner lands. */
  x: number;
  y: number;
}

/**
 * Where a block sits on a fixed canvas: scaled to fill the space inside the
 * margin, and centred on both axes.
 *
 * The scale is deliberately not capped at 1. A six-line paste on a 1200×630 card
 * would otherwise sit at a third of the width with a lake of gradient around it,
 * which is a worse card than the same block enlarged — and enlarging costs
 * nothing, because every glyph is drawn from a vector at whatever size this
 * lands on rather than resampled from a bitmap. The other direction is the one
 * with a real cost, and it is the accepted one: a long paste renders below the
 * fixed 15px because fitting the canvas is the whole point of asking for it.
 *
 * Pure, and the only part of the aspect geometry that needs testing — everything
 * else is a multiplication.
 */
export function fitToCanvas(blockWidth: number, blockHeight: number, preset: AspectPreset): CanvasFit {
  const margin = Math.min(preset.width, preset.height) * ASPECT_MARGIN_RATIO;
  const scale = Math.min(
    (preset.width - margin * 2) / blockWidth,
    (preset.height - margin * 2) / blockHeight,
  );
  return {
    scale,
    x: (preset.width - blockWidth * scale) / 2,
    y: (preset.height - blockHeight * scale) / 2,
  };
}

export interface LaidSpan {
  text: string;
  x: number;
  width: number;
  style: ResolvedStyle;
}

export interface LaidLine {
  top: number;
  baseline: number;
  spans: LaidSpan[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  lines: LaidLine[];
  fontSize: number;
  lineHeight: number;
  charWidth: number;
  chromeHeight: number;
  /** Widest row of text, in px, after wrapping. Only a wider chrome title can beat it. */
  widest: number;
  /**
   * The column count as pixels — where the text wraps, and what the editor's own
   * box has to be so the browser breaks the same rows this layout did. Not the
   * same as the terminal's inner width, which a long window title can widen.
   */
  wrapWidth: number;
  /** Vertical padding that grows an inline background to a full terminal cell. */
  halfLeading: number;
  /** `TERMINAL_PADDING`, scaled. The gap between the terminal edge and its text. */
  terminalPadding: number;
  /**
   * What the block was multiplied by to fill a fixed canvas — 1 whenever there
   * is no aspect, which is the only case before this existed.
   *
   * Every measurement in this object is already scaled by it. It is here for the
   * two numbers that come from `FrameSettings` rather than from layout and so
   * cannot be: the corner radius and the shadow.
   */
  contentScale: number;
  terminal: Rect;
  width: number;
  height: number;
}

let measureContext: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D {
  if (!measureContext) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is unavailable");
    measureContext = ctx;
  }
  return measureContext;
}

export function fontString(fontSize: number, bold: boolean, italic: boolean): string {
  return `${italic ? "italic " : ""}${bold ? 700 : 400} ${fontSize}px ${FONT_FAMILY}`;
}

function measureWidth(text: string, fontSize: number, bold: boolean, italic: boolean): number {
  if (text.length === 0) return 0;
  const ctx = context();
  ctx.font = fontString(fontSize, bold, italic);
  return ctx.measureText(text).width;
}

/**
 * Half-leading from real font metrics, so the canvas, the SVG and the browser's
 * own `line-height` all put the baseline in the same place.
 *
 * `halfLeading` is also what the editor pads a background-filled run by: the
 * browser paints an inline background over the font's content box only, while a
 * terminal fills the whole cell.
 */
function leading(fontSize: number, lineHeight: number): { baseline: number; halfLeading: number } {
  const ctx = context();
  ctx.font = fontString(fontSize, false, false);
  const metrics = ctx.measureText("Mg");
  const ascent = metrics.fontBoundingBoxAscent || fontSize * 0.8;
  const descent = metrics.fontBoundingBoxDescent || fontSize * 0.2;
  const halfLeading = (lineHeight - (ascent + descent)) / 2;
  return { baseline: halfLeading + ascent, halfLeading };
}

function measureCharWidth(fontSize: number): number {
  return measureWidth("M", fontSize, false, false);
}

function chromeHeightFor(frame: FrameSettings): number {
  return frame.showChrome ? Math.round(FONT_SIZE * 2.7) : 0;
}

export function computeLayout(
  renderLines: readonly RenderLine[],
  theme: Theme,
  frame: FrameSettings,
): Layout {
  const fontSize = FONT_SIZE;
  const lineHeight = Math.round(fontSize * LINE_HEIGHT_RATIO);
  const charWidth = measureCharWidth(fontSize);
  const chromeHeight = chromeHeightFor(frame);
  const { baseline: offset, halfLeading } = leading(fontSize, lineHeight);
  const contentTop = chromeHeight + TERMINAL_PADDING;

  // Long lines become several rows here, once, so everything downstream — the
  // height, the exporters' display list — counts rows without knowing that a
  // logical line can be more than one.
  const wrapped = wrapRenderLines(renderLines, frame.columns);

  const lines: LaidLine[] = wrapped.map((line, index) => {
    const top = contentTop + index * lineHeight;
    const spans: LaidSpan[] = [];
    let x = TERMINAL_PADDING;
    for (const span of line.spans) {
      if (span.text.length === 0) continue;
      const style = resolveStyle(span.marks, span.role, theme);
      const width = measureWidth(span.text, fontSize, style.bold, style.italic);
      spans.push({ text: span.text, x, width, style });
      x += width;
    }
    return { top, baseline: top + offset, spans };
  });

  const widest = lines.reduce((max, line) => {
    const last = line.spans[line.spans.length - 1];
    return Math.max(max, last ? last.x + last.width - TERMINAL_PADDING : 0);
  }, 0);

  const titleWidth = frame.showChrome && frame.title ? measureWidth(frame.title, fontSize * 0.85, false, false) : 0;
  // Traffic lights on the left need matching space on the right for the title to stay centered.
  const chromeMinimum = titleWidth > 0 ? titleWidth + chromeHeight * 3 : 0;

  const wrapWidth = Math.ceil(frame.columns * charWidth);
  // `widest` is in here as a guard rather than as a sizing rule: the rows are cut
  // to a character count, so the only way one can measure past `wrapWidth` is a
  // character the bundled font does not cover — an emoji or a box-drawing glyph,
  // laid out against the reader's system font at whatever advance that has.
  // Better a wider block than one that clips a glyph in half. The title is the
  // one thing that widens it on purpose.
  const contentWidth = Math.ceil(Math.max(widest, wrapWidth, chromeMinimum - 2 * TERMINAL_PADDING));

  const blockWidth = contentWidth + TERMINAL_PADDING * 2;
  const blockHeight = chromeHeight + TERMINAL_PADDING * 2 + Math.max(1, lines.length) * lineHeight;

  // A fixed canvas replaces both of the things that used to decide the image
  // size: the block fills the canvas rather than the canvas fitting the block,
  // and the margin comes from the canvas rather than from `framePadding`.
  const preset = aspectById(frame.aspect);
  const fit = preset ? fitToCanvas(blockWidth, blockHeight, preset) : null;
  const scale = fit ? fit.scale : 1;

  const terminal: Rect = {
    x: fit ? fit.x : frame.framePadding,
    y: fit ? fit.y : frame.framePadding,
    width: blockWidth * scale,
    height: blockHeight * scale,
  };

  return {
    // Laid out once at `FONT_SIZE` and multiplied, rather than measured again at
    // the scaled size: `measureText` is not exactly linear in font size once
    // hinting is involved, and a second measurement pass could put a row's last
    // span a fraction past where the wrap said it ends. Multiplying cannot.
    lines: scale === 1 ? lines : lines.map((line) => scaleLine(line, scale)),
    fontSize: fontSize * scale,
    lineHeight: lineHeight * scale,
    charWidth: charWidth * scale,
    chromeHeight: chromeHeight * scale,
    widest: widest * scale,
    wrapWidth: wrapWidth * scale,
    halfLeading: halfLeading * scale,
    terminalPadding: TERMINAL_PADDING * scale,
    contentScale: scale,
    terminal,
    width: preset ? preset.width : terminal.width + frame.framePadding * 2,
    height: preset ? preset.height : terminal.height + frame.framePadding * 2,
  };
}

function scaleLine(line: LaidLine, scale: number): LaidLine {
  return {
    top: line.top * scale,
    baseline: line.baseline * scale,
    spans: line.spans.map((span) => ({ ...span, x: span.x * scale, width: span.width * scale })),
  };
}

/** macOS-style window buttons, positioned relative to the chrome bar. */
export interface TrafficLight {
  cx: number;
  cy: number;
  r: number;
  fill: string;
}

export function trafficLights(layout: Layout, frame: FrameSettings): TrafficLight[] {
  if (!frame.showChrome) return [];
  // Rounded at natural size and scaled after, so the three dots stay the size
  // they are on a free image and grow with the block on a fixed canvas.
  const r = Math.max(4, Math.round(FONT_SIZE * 0.38)) * layout.contentScale;
  const cy = layout.terminal.y + layout.chromeHeight / 2;
  const gap = r * 3.4;
  const startX = layout.terminal.x + layout.terminalPadding + r;
  return ["#ff5f57", "#febc2e", "#28c840"].map((fill, index) => ({
    cx: startX + index * gap,
    cy,
    r,
    fill,
  }));
}
