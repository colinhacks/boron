import { parseAnsi } from "./core/ansi.ts";
import { documentToRenderLines, parsedLinesToDocument } from "./core/document.ts";
import { HIGHLIGHT_LANGUAGES, highlightToAnsi, isLanguageId } from "./core/highlight.ts";
import { toPlainText } from "./core/serialize.ts";
import { themeById } from "./core/themes.ts";
import { themedBackground } from "./export/backdrop.ts";
import { backgroundById } from "./export/background.ts";
import { ensureFontsLoaded, hasIconGlyphs } from "./export/fonts.ts";
import { IMAGE_FORMATS, renderBlob, type ImageFormat } from "./export/index.ts";
import { computeLayout } from "./export/layout.ts";
import { buildShareUrl } from "./share.ts";
import type { Workspace } from "./workspace.ts";

/**
 * `window.boron` — the Save button, for a script.
 *
 * An agent that wants a picture opens a share link in a headless browser and
 * calls `export`. Without this it has to find the Save button by its label and
 * the format menu by its class names, and every copy of that script on someone
 * else's machine breaks the next time the toolbar changes. So this object is a
 * promise in the same way `wire.ts` is: v1 keeps its shape forever, and a change
 * it cannot express is a `version: 2` beside it.
 *
 * It exports the workspace on screen through the same `renderBlob` as the button,
 * so the pixels are the ones a person would get. It counts nothing in analytics:
 * the export events are there to say which formats *people* choose.
 */
export interface PageApiV1 {
  version: 1;
  export(options?: PageExportOptions): Promise<PageExport>;
}

export interface PageExportOptions {
  /** `png`, `svg`, `jpeg` or `webp`. Default `png`. */
  format?: string;
  /**
   * Re-colors the document with the app's own highlighter first, as picking a
   * language from the Syntax control does. A link's content is the picture, so
   * plain code written into one arrives uncolored without this.
   */
  language?: string;
}

export interface PageExport {
  /**
   * The file, base64-encoded. A string rather than a `Blob` because the caller
   * is on the far side of a DevTools protocol, which can only hand back values
   * that survive JSON.
   */
  data: string;
  /** Its MIME type. */
  type: string;
  /** A link that reopens exactly this picture, language colors included. */
  link: string;
}

declare global {
  interface Window {
    boron?: PageApiV1;
  }
}

/**
 * What an export of `workspace` with these options would draw, or a thrown error
 * naming the values that are accepted. Separate from the rendering so it can be
 * checked without a canvas.
 */
export function resolveExport(
  workspace: Workspace,
  { format = "png", language }: PageExportOptions = {},
): { workspace: Workspace; format: ImageFormat } {
  const spec = IMAGE_FORMATS.find((candidate) => candidate.id === format);
  if (!spec) {
    throw new Error(`Unknown format "${format}", expected one of ${IMAGE_FORMATS.map(({ id }) => id).join(", ")}`);
  }
  if (language === undefined) return { workspace, format: spec.id };
  if (!isLanguageId(language)) {
    throw new Error(
      `Unknown language "${language}", expected one of ${HIGHLIGHT_LANGUAGES.map(({ id }) => id).join(", ")}`,
    );
  }

  const code = toPlainText(documentToRenderLines(workspace.document));
  const document = parsedLinesToDocument(parseAnsi(highlightToAnsi(code, language)));
  return { workspace: { ...workspace, document, highlight: language }, format: spec.id };
}

async function render(workspace: Workspace, format: ImageFormat): Promise<Blob> {
  const icons =
    hasIconGlyphs(workspace.frame.title) ||
    workspace.document.some((line) => line.children.some((leaf) => hasIconGlyphs(leaf.text)));
  // A canvas does not repaint once a font lands, so the faces come first.
  await ensureFontsLoaded({ icons });

  const theme = themeById(workspace.themeId);
  const layout = computeLayout(documentToRenderLines(workspace.document), theme, workspace.frame);
  const background = themedBackground(backgroundById(workspace.backgroundId), theme);
  return renderBlob({ layout, frame: workspace.frame, theme, background }, format);
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function exportWorkspace(
  workspace: Workspace,
  options: PageExportOptions | undefined,
  base: string,
): Promise<PageExport> {
  const resolved = resolveExport(workspace, options);
  const [blob, link] = await Promise.all([
    render(resolved.workspace, resolved.format),
    buildShareUrl(resolved.workspace, base),
  ]);
  return { data: await toBase64(blob), type: blob.type, link };
}

/** Puts `window.boron` on the page for as long as the app is mounted. */
export function installPageApi(current: () => Workspace): () => void {
  const api: PageApiV1 = {
    version: 1,
    export: (options) => exportWorkspace(current(), options, window.location.href),
  };
  window.boron = api;
  return () => {
    if (window.boron === api) delete window.boron;
  };
}
