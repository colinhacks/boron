import iconsUrl from "../assets/fonts/boron-icons.woff2?url";
import italicUrl from "../assets/fonts/boron-mono-400-italic.woff2?url";
import regularUrl from "../assets/fonts/boron-mono-400-normal.woff2?url";
import boldItalicUrl from "../assets/fonts/boron-mono-700-italic.woff2?url";
import boldUrl from "../assets/fonts/boron-mono-700-normal.woff2?url";

export const FONT_NAME = "Boron Mono";
export const ICON_FONT_NAME = "Boron Icons";

/**
 * The icon family sits *after* the text family, and that ordering is the whole
 * mechanism. A browser resolves the stack per character, not per run: every
 * character the text faces cover is drawn from them, and only the ones they do
 * not fall through to the icons. So one icon face serves every weight and style
 * without a `unicode-range` to keep in step with the subsetter.
 */
export const FONT_FAMILY = `"${FONT_NAME}", "${ICON_FONT_NAME}", ui-monospace, SFMono-Regular, Menlo, monospace`;

/**
 * The Private Use Area, where Nerd Fonts puts the ~10,500 glyphs it patches in.
 * Keep in step with `PUA_RANGES` in scripts/build-fonts.py: that file subsets on
 * these boundaries and this one decides whether the resulting face is worth
 * fetching, so a disagreement shows up as a tofu box rather than as an error.
 *
 * Testing the PUA rather than "U+E000 and above" is deliberate. The patched font
 * maps about fifty non-icon glyphs above U+E000 — ℂ ℍ ℕ, some fullwidth forms,
 * and U+FFFD, the replacement character you get for undecodable bytes — and all
 * of them are in the text faces. Treating those as icons would make a single `�`
 * in a paste pull down a megabyte.
 */
const ICON_RANGES: readonly (readonly [number, number])[] = [
  [0xe000, 0xf8ff],
  [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
];

/**
 * The icon face is declared across the whole weight range rather than at 400, so
 * a bold run matches it exactly instead of being handed a synthetic bold.
 */
const ICON_WEIGHT_RANGE = "100 900";

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

/** A run of text as an exporter will draw it — enough to pick the face for it. */
export interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Which faces a particular document actually needs. */
export interface FontUsage {
  /** The text faces it paints with, in a stable order. */
  faces: readonly Face[];
  /** Whether anything it draws needs a glyph from the icon face. */
  icons: boolean;
}

/** Whether `text` contains a codepoint only the icon face covers. */
export function hasIconGlyphs(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (ICON_RANGES.some(([low, high]) => code >= low && code <= high)) return true;
  }
  return false;
}

/**
 * What `runs` need, so an export can leave the rest out.
 *
 * Worth doing because the font dominates a self-contained SVG: before any of
 * this the four latin faces were 116 KB of base64 around a 3 KB picture. Most
 * documents have no italic in them at all, so the common export now inlines two
 * faces rather than four and comes out smaller than it did.
 */
export function fontUsage(runs: Iterable<TextRun>): FontUsage {
  const used = new Set<Face>();
  let icons = false;
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const weight = run.bold ? "700" : "400";
    const style = run.italic ? "italic" : "normal";
    const face = FACES.find((candidate) => candidate.weight === weight && candidate.style === style);
    if (face) used.add(face);
    icons ||= hasIconGlyphs(run.text);
  }
  // Filtered rather than taken from the set so the order is the declaration
  // order and not whatever order the document happened to use its styles in —
  // the same document has to export byte-for-byte the same file every time.
  return { faces: FACES.filter((face) => used.has(face)), icons };
}

const loading = new Map<string, Promise<void>>();

function loadFace(family: string, url: string, descriptors: FontFaceDescriptors): Promise<void> {
  const key = `${family} ${url}`;
  let pending = loading.get(key);
  if (!pending) {
    pending = new FontFace(family, `url(${url}) format("woff2")`, descriptors).load().then((face) => {
      document.fonts.add(face);
    });
    loading.set(key, pending);
  }
  return pending;
}

/**
 * Register the faces we render with. Declaring them from JS rather than a
 * stylesheet keeps the display font and the font embedded into exported SVG
 * byte-identical — there is only one set of files.
 *
 * The icon face is opt-in because it is 880 KB against 203 KB for all four text
 * faces, and most terminal screenshots contain no icon at all. Callers that are
 * about to rasterize have to await this: unlike the browser's own lazy fetch, a
 * canvas `fillText` will not come back and repaint once the font lands.
 */
export function ensureFontsLoaded({ icons = false }: { icons?: boolean } = {}): Promise<void> {
  const pending = FACES.map((face) => loadFace(FONT_NAME, face.url, { weight: face.weight, style: face.style }));
  if (icons) pending.push(loadFace(ICON_FONT_NAME, iconsUrl, { weight: ICON_WEIGHT_RANGE }));
  return Promise.all(pending).then(() => undefined);
}

const dataUrls = new Map<string, Promise<string>>();

function toDataUrl(url: string): Promise<string> {
  let pending = dataUrls.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      return `data:font/woff2;base64,${btoa(binary)}`;
    })();
    dataUrls.set(url, pending);
  }
  return pending;
}

function faceRule(family: string, dataUrl: string, style: string, weight: string): string {
  return [
    "@font-face {",
    `  font-family: "${family}";`,
    `  font-style: ${style};`,
    `  font-weight: ${weight};`,
    `  src: url("${dataUrl}") format("woff2");`,
    "}",
  ].join("\n");
}

/** `@font-face` rules with the fonts inlined, for a self-contained SVG. */
export async function embeddedFontCss(usage: FontUsage): Promise<string> {
  const rules = await Promise.all(
    usage.faces.map(async (face) => faceRule(FONT_NAME, await toDataUrl(face.url), face.style, face.weight)),
  );
  if (usage.icons) {
    // One rule for every weight: the patcher inserts the same outlines into all
    // four source faces, so a second copy would have nothing different to say.
    // Claiming the whole weight range is what stops a bold run from getting a
    // synthetic-bold icon. An italic run can still be given a synthetic oblique
    // — CSS has no way to declare one face upright *and* italic — but a slanted
    // icon inside an italic span is a good deal for 660 KB.
    rules.push(faceRule(ICON_FONT_NAME, await toDataUrl(iconsUrl), "normal", ICON_WEIGHT_RANGE));
  }
  return rules.join("\n");
}
