import { resolveStyle, type ResolvedStyle } from "../core/style.ts";
import type { Theme } from "../core/themes.ts";
import type { RenderLine } from "../core/types.ts";
import { FONT_FAMILY } from "./fonts.ts";

/**
 * Space between the terminal edge and its text. Fixed rather than tunable: it
 * is the one measurement a real terminal doesn't let you set either, and every
 * value but this one made the block look either cramped or hollow.
 */
export const TERMINAL_PADDING = 24;

export interface FrameSettings {
  fontSize: number;
  lineHeightRatio: number;
  /** Space between the terminal and the edge of the image. */
  framePadding: number;
  radius: number;
  showChrome: boolean;
  title: string;
  /** 0-100. Zero casts no shadow at all. */
  shadowStrength: number;
  /** Keeps a two-word snippet from exporting as a sliver. */
  minColumns: number;
}

export const DEFAULT_FRAME: FrameSettings = {
  fontSize: 15,
  lineHeightRatio: 1.55,
  framePadding: 48,
  radius: 12,
  showChrome: true,
  title: "",
  shadowStrength: 100,
  minColumns: 80,
};

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
  /** Vertical padding that grows an inline background to a full terminal cell. */
  halfLeading: number;
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
  return frame.showChrome ? Math.round(frame.fontSize * 2.7) : 0;
}

export function computeLayout(
  renderLines: readonly RenderLine[],
  theme: Theme,
  frame: FrameSettings,
): Layout {
  const { fontSize } = frame;
  const lineHeight = Math.round(fontSize * frame.lineHeightRatio);
  const charWidth = measureCharWidth(fontSize);
  const chromeHeight = chromeHeightFor(frame);
  const { baseline: offset, halfLeading } = leading(fontSize, lineHeight);
  const contentTop = chromeHeight + TERMINAL_PADDING;

  const lines: LaidLine[] = renderLines.map((line, index) => {
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

  const contentWidth = Math.ceil(
    Math.max(widest, frame.minColumns * charWidth, chromeMinimum - 2 * TERMINAL_PADDING),
  );

  const terminal: Rect = {
    x: frame.framePadding,
    y: frame.framePadding,
    width: contentWidth + TERMINAL_PADDING * 2,
    height: chromeHeight + TERMINAL_PADDING * 2 + Math.max(1, lines.length) * lineHeight,
  };

  return {
    lines,
    fontSize,
    lineHeight,
    charWidth,
    chromeHeight,
    halfLeading,
    terminal,
    width: terminal.width + frame.framePadding * 2,
    height: terminal.height + frame.framePadding * 2,
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
  const r = Math.max(4, Math.round(frame.fontSize * 0.38));
  const cy = layout.terminal.y + layout.chromeHeight / 2;
  const gap = r * 3.4;
  const startX = layout.terminal.x + TERMINAL_PADDING + r;
  return ["#ff5f57", "#febc2e", "#28c840"].map((fill, index) => ({
    cx: startX + index * gap,
    cy,
    r,
    fill,
  }));
}
