import { ensureFontsLoaded } from "./fonts.ts";
import { fontString } from "./layout.ts";
import { buildOps, isGradient, type Op, type Paint } from "./paint.ts";
import type { Scene } from "./scene.ts";

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

function fillStyle(ctx: CanvasRenderingContext2D, paint: Paint): string | CanvasGradient {
  if (!isGradient(paint)) return paint;
  const gradient = ctx.createLinearGradient(paint.x0, paint.y0, paint.x1, paint.y1);
  paint.stops.forEach((stop, index) => {
    gradient.addColorStop(paint.stops.length === 1 ? 0 : index / (paint.stops.length - 1), stop);
  });
  return gradient;
}

function paint(ctx: CanvasRenderingContext2D, ops: readonly Op[]): void {
  for (const op of ops) {
    switch (op.op) {
      case "fill":
        ctx.fillStyle = fillStyle(ctx, op.paint);
        ctx.fillRect(op.x, op.y, op.width, op.height);
        break;

      case "panel":
        // A canvas shadow is a property of a fill rather than of a shape, so the
        // panel is filled twice: once to cast, once to cover the blur that lands
        // inside its own edges.
        if (op.shadow) {
          ctx.save();
          ctx.shadowColor = `rgba(0, 0, 0, ${op.shadow.opacity})`;
          ctx.shadowBlur = op.shadow.stdDeviation * 2;
          ctx.shadowOffsetY = op.shadow.offsetY;
          ctx.fillStyle = op.fill;
          roundedRect(ctx, op.x, op.y, op.width, op.height, op.radius);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = op.fill;
        roundedRect(ctx, op.x, op.y, op.width, op.height, op.radius);
        ctx.fill();
        break;

      case "circle":
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
        ctx.fillStyle = op.fill;
        ctx.fill();
        break;

      case "text":
        ctx.font = fontString(op.size, op.bold, op.italic);
        ctx.fillStyle = op.fill;
        ctx.textAlign = op.centered ? "center" : "left";
        ctx.textBaseline = op.centered ? "middle" : "alphabetic";
        ctx.fillText(op.text, op.x, op.y);
        break;

      case "clip":
        ctx.save();
        roundedRect(ctx, op.x, op.y, op.width, op.height, op.radius);
        ctx.clip();
        paint(ctx, op.children);
        ctx.restore();
        break;
    }
  }
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, opaqueBackdrop?: string): void {
  ctx.clearRect(0, 0, scene.layout.width, scene.layout.height);
  paint(ctx, buildOps(scene, opaqueBackdrop));
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
