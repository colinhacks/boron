import { gradientEndpoints } from "./background.ts";
import { ensureFontsLoaded } from "./fonts.ts";
import { fontString, trafficLights } from "./layout.ts";
import { CHROME_TITLE_SCALE, chromeBorderColor, chromeTitleColor, resolveShadow, type Scene } from "./scene.ts";

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * `opaqueBackdrop` is painted after the clear and beneath everything else, for
 * formats with no alpha channel — without it a transparent backdrop encodes as
 * black rather than as the terminal's own color.
 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, opaqueBackdrop?: string): void {
  const { layout, frame, theme, background } = scene;
  const { terminal } = layout;

  ctx.clearRect(0, 0, layout.width, layout.height);

  if (opaqueBackdrop) {
    ctx.fillStyle = opaqueBackdrop;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }

  if (background) {
    const { x0, y0, x1, y1 } = gradientEndpoints(background.angle, layout.width, layout.height);
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    background.stops.forEach((stop, index) => {
      gradient.addColorStop(background.stops.length === 1 ? 0 : index / (background.stops.length - 1), stop);
    });
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, layout.width, layout.height);
  }

  const shadow = resolveShadow(frame.shadowStrength);
  if (shadow) {
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${shadow.opacity})`;
    ctx.shadowBlur = shadow.stdDeviation * 2;
    ctx.shadowOffsetY = shadow.offsetY;
    ctx.fillStyle = theme.background;
    roundedRect(ctx, terminal.x, terminal.y, terminal.width, terminal.height, frame.radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = theme.background;
  roundedRect(ctx, terminal.x, terminal.y, terminal.width, terminal.height, frame.radius);
  ctx.fill();

  ctx.save();
  roundedRect(ctx, terminal.x, terminal.y, terminal.width, terminal.height, frame.radius);
  ctx.clip();

  if (frame.showChrome) {
    ctx.fillStyle = chromeBorderColor(theme);
    ctx.fillRect(terminal.x, terminal.y + layout.chromeHeight - 1, terminal.width, 1);

    for (const light of trafficLights(layout, frame)) {
      ctx.beginPath();
      ctx.arc(light.cx, light.cy, light.r, 0, Math.PI * 2);
      ctx.fillStyle = light.fill;
      ctx.fill();
    }

    if (frame.title) {
      ctx.font = fontString(layout.fontSize * CHROME_TITLE_SCALE, false, false);
      ctx.fillStyle = chromeTitleColor(theme);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(frame.title, terminal.x + terminal.width / 2, terminal.y + layout.chromeHeight / 2);
      ctx.textAlign = "left";
    }
  }

  ctx.textBaseline = "alphabetic";
  for (const line of layout.lines) {
    for (const span of line.spans) {
      if (!span.style.background) continue;
      ctx.fillStyle = span.style.background;
      ctx.fillRect(terminal.x + span.x, terminal.y + line.top, span.width, layout.lineHeight);
    }
    for (const span of line.spans) {
      if (span.style.opacity === 0) continue;
      ctx.globalAlpha = span.style.opacity;
      ctx.fillStyle = span.style.color;
      ctx.font = fontString(layout.fontSize, span.style.bold, span.style.italic);
      const x = terminal.x + span.x;
      const y = terminal.y + line.baseline;
      ctx.fillText(span.text, x, y);

      const thickness = Math.max(1, Math.round(layout.fontSize / 14));
      if (span.style.underline) {
        ctx.fillRect(x, y + layout.fontSize * 0.14, span.width, thickness);
      }
      if (span.style.strikethrough) {
        ctx.fillRect(x, y - layout.fontSize * 0.28, span.width, thickness);
      }
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}

export async function renderToCanvas(scene: Scene, scale: number, opaqueBackdrop?: string): Promise<HTMLCanvasElement> {
  await ensureFontsLoaded();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(scene.layout.width * scale);
  canvas.height = Math.ceil(scene.layout.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable");
  ctx.scale(scale, scale);
  drawScene(ctx, scene, opaqueBackdrop);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Could not encode ${type}`))),
      type,
      quality,
    );
  });
}
