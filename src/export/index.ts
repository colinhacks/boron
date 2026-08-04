import { canvasToBlob, renderToCanvas } from "./canvas.ts";
import { renderToSvg } from "./svg.ts";
import type { Scene } from "./scene.ts";

export type ImageFormat = "png" | "jpeg" | "webp" | "svg";

export const IMAGE_FORMATS: readonly { id: ImageFormat; label: string; extension: string }[] = [
  { id: "png", label: "PNG", extension: "png" },
  { id: "svg", label: "SVG", extension: "svg" },
  { id: "jpeg", label: "JPEG", extension: "jpg" },
  { id: "webp", label: "WebP", extension: "webp" },
];

const MIME: Record<Exclude<ImageFormat, "svg">, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function renderBlob(scene: Scene, format: ImageFormat, scale: number): Promise<Blob> {
  if (format === "svg") {
    const svg = await renderToSvg(scene);
    return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  }
  // JPEG has no alpha, so a transparent frame would come out black.
  const backdrop = format === "jpeg" && !scene.background ? scene.theme.background : undefined;
  const canvas = await renderToCanvas(scene, scale, backdrop);
  return canvasToBlob(canvas, MIME[format], format === "png" ? undefined : 0.95);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next frame so the navigation has committed.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

export async function copyImageToClipboard(scene: Scene, scale: number): Promise<void> {
  // Safari requires the ClipboardItem to be constructed with a promise, so the
  // write stays inside the user-gesture window.
  const item = new ClipboardItem({ "image/png": renderBlob(scene, "png", scale) });
  await navigator.clipboard.write([item]);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export { renderToCanvas, renderToSvg };
export type { Scene };
