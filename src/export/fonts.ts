import boldItalicUrl from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-italic.woff2?url";
import boldUrl from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2?url";
import italicUrl from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-italic.woff2?url";
import regularUrl from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2?url";

export const FONT_NAME = "Boron Mono";
export const FONT_FAMILY = `"${FONT_NAME}", ui-monospace, SFMono-Regular, Menlo, monospace`;

interface Face {
  url: string;
  weight: "400" | "700";
  style: "normal" | "italic";
}

const FACES: readonly Face[] = [
  { url: regularUrl, weight: "400", style: "normal" },
  { url: italicUrl, weight: "400", style: "italic" },
  { url: boldUrl, weight: "700", style: "normal" },
  { url: boldItalicUrl, weight: "700", style: "italic" },
];

let loadPromise: Promise<void> | null = null;

/**
 * Register the four faces we render with. Declaring them from JS rather than a
 * stylesheet keeps the display font and the font embedded into exported SVG
 * byte-identical — there is only one set of files.
 */
export function ensureFontsLoaded(): Promise<void> {
  loadPromise ??= Promise.all(
    FACES.map(async (face) => {
      const font = new FontFace(FONT_NAME, `url(${face.url}) format("woff2")`, {
        weight: face.weight,
        style: face.style,
      });
      await font.load();
      document.fonts.add(font);
    }),
  ).then(() => undefined);
  return loadPromise;
}

async function toDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:font/woff2;base64,${btoa(binary)}`;
}

let cssPromise: Promise<string> | null = null;

/** `@font-face` rules with the fonts inlined, for a self-contained SVG. */
export function embeddedFontCss(): Promise<string> {
  cssPromise ??= Promise.all(
    FACES.map(async (face) => {
      const dataUrl = await toDataUrl(face.url);
      return [
        "@font-face {",
        `  font-family: "${FONT_NAME}";`,
        `  font-style: ${face.style};`,
        `  font-weight: ${face.weight};`,
        `  src: url("${dataUrl}") format("woff2");`,
        "}",
      ].join("\n");
    }),
  ).then((rules) => rules.join("\n"));
  return cssPromise;
}
