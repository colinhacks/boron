import { flatColor, gradientEndpoints } from "./background.ts";
import { trafficLights, type Layout } from "./layout.ts";
import { CHROME_TITLE_SCALE, chromeBorderColor, chromeTitleColor, resolveShadow, type Scene } from "./scene.ts";

/**
 * What the exporters draw, as data.
 *
 * The canvas and the SVG used to each walk the scene themselves, which meant two
 * copies of where an underline sits, how thick it is, that backgrounds are a
 * separate pass before text, and that the chrome border is the last pixel of the
 * bar rather than the first of the body. Two copies of a number that has to
 * agree is a bug with a delay on it — nothing throws when they drift, the
 * picture on screen just stops being the picture you save.
 *
 * So the scene is walked exactly once, here, into a list of primitives. What is
 * left in each renderer is only the part that genuinely differs: how you say
 * "filled rectangle" to a canvas versus to an SVG file.
 */
export type Paint = string | LinearGradient;

export interface LinearGradient {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stops: readonly string[];
}

export function isGradient(paint: Paint): paint is LinearGradient {
  return typeof paint !== "string";
}

export interface Shadow {
  offsetY: number;
  stdDeviation: number;
  opacity: number;
}

export type Op =
  | { op: "fill"; x: number; y: number; width: number; height: number; paint: Paint }
  /** The terminal body: a rounded rectangle that may cast a shadow. */
  | { op: "panel"; x: number; y: number; width: number; height: number; radius: number; fill: string; shadow: Shadow | null }
  | { op: "circle"; cx: number; cy: number; r: number; fill: string }
  | { op: "text"; x: number; y: number; text: string; size: number; bold: boolean; italic: boolean; fill: string; centered: boolean }
  /** Everything inside is clipped to the rounded rectangle. */
  | { op: "clip"; x: number; y: number; width: number; height: number; radius: number; children: Op[] };

/** Underline and strikethrough sit here, at this weight, in both exporters. */
function ruleThickness(fontSize: number): number {
  return Math.max(1, Math.round(fontSize / 14));
}

const UNDERLINE_OFFSET = 0.14;
const STRIKETHROUGH_OFFSET = -0.28;

function chromeOps(layout: Layout, scene: Scene): Op[] {
  const { frame, theme } = scene;
  const { terminal } = layout;
  if (!frame.showChrome) return [];

  const ops: Op[] = [
    // The border is the bar's last pixel, not the body's first.
    {
      op: "fill",
      x: terminal.x,
      y: terminal.y + layout.chromeHeight - 1,
      width: terminal.width,
      height: 1,
      paint: chromeBorderColor(theme),
    },
  ];

  for (const light of trafficLights(layout, frame)) {
    ops.push({ op: "circle", cx: light.cx, cy: light.cy, r: light.r, fill: light.fill });
  }

  if (frame.title) {
    ops.push({
      op: "text",
      x: terminal.x + terminal.width / 2,
      y: terminal.y + layout.chromeHeight / 2,
      text: frame.title,
      size: layout.fontSize * CHROME_TITLE_SCALE,
      bold: false,
      italic: false,
      fill: chromeTitleColor(theme),
      centered: true,
    });
  }

  return ops;
}

function bodyOps(layout: Layout): Op[] {
  const { terminal } = layout;
  const ops: Op[] = [];
  const thickness = ruleThickness(layout.fontSize);

  for (const line of layout.lines) {
    // Backgrounds are a pass of their own, ahead of every glyph on the line: a
    // filled run has to sit under its neighbour's descenders, not over them.
    for (const span of line.spans) {
      if (!span.style.background) continue;
      ops.push({
        op: "fill",
        x: terminal.x + span.x,
        y: terminal.y + line.top,
        width: span.width,
        height: layout.lineHeight,
        paint: span.style.background,
      });
    }

    for (const span of line.spans) {
      // SGR 8. Nothing is drawn, but the background above already was — a
      // terminal conceals the characters, not the cell.
      if (span.style.opacity === 0) continue;
      const x = terminal.x + span.x;
      const y = terminal.y + line.baseline;

      ops.push({
        op: "text",
        x,
        y,
        text: span.text,
        size: layout.fontSize,
        bold: span.style.bold,
        italic: span.style.italic,
        fill: span.style.color,
        centered: false,
      });

      for (const [enabled, offset] of [
        [span.style.underline, UNDERLINE_OFFSET],
        [span.style.strikethrough, STRIKETHROUGH_OFFSET],
      ] as const) {
        if (!enabled) continue;
        ops.push({
          op: "fill",
          x,
          y: y + layout.fontSize * offset,
          width: span.width,
          height: thickness,
          paint: span.style.color,
        });
      }
    }
  }

  return ops;
}

/**
 * The whole scene as primitives, back to front.
 *
 * `opaqueBackdrop` is painted beneath everything, for formats with no alpha
 * channel — without it a transparent backdrop encodes as black rather than as
 * the terminal's own color.
 */
export function buildOps(scene: Scene, opaqueBackdrop?: string): Op[] {
  const { layout, frame, theme, background } = scene;
  const { terminal } = layout;
  const ops: Op[] = [];

  if (opaqueBackdrop) {
    ops.push({ op: "fill", x: 0, y: 0, width: layout.width, height: layout.height, paint: opaqueBackdrop });
  }

  if (background) {
    // A flat fill has no gradient line to compute and no reason to carry one:
    // the SVG would emit a `<linearGradient>` with a single stop, and both
    // renderers already say "filled rectangle" in one colour perfectly well.
    const flat = flatColor(background);
    ops.push({
      op: "fill",
      x: 0,
      y: 0,
      width: layout.width,
      height: layout.height,
      paint:
        flat ??
        { ...gradientEndpoints(background.angle, layout.width, layout.height), stops: background.stops },
    });
  }

  ops.push({
    op: "panel",
    x: terminal.x,
    y: terminal.y,
    width: terminal.width,
    height: terminal.height,
    // The radius and the shadow are the two measurements that come from the
    // settings rather than from `computeLayout`, so they are the two the layout
    // could not scale on the way past.
    radius: frame.radius * layout.contentScale,
    fill: theme.background,
    shadow: resolveShadow(frame.shadowStrength, layout.contentScale),
  });

  ops.push({
    op: "clip",
    x: terminal.x,
    y: terminal.y,
    width: terminal.width,
    height: terminal.height,
    radius: frame.radius * layout.contentScale,
    children: [...chromeOps(layout, scene), ...bodyOps(layout)],
  });

  return ops;
}

/**
 * Every glyph the scene will draw, flattened out of the clip nesting.
 *
 * The ops are where to ask, rather than the document: the chrome title is drawn
 * from the frame settings and never appears in the document at all, and it is
 * exactly the sort of thing that would be discovered missing from an export
 * after someone pasted an icon into a window title.
 */
export function textOps(ops: readonly Op[]): Extract<Op, { op: "text" }>[] {
  const found: Extract<Op, { op: "text" }>[] = [];
  for (const op of ops) {
    if (op.op === "text") found.push(op);
    else if (op.op === "clip") found.push(...textOps(op.children));
  }
  return found;
}
