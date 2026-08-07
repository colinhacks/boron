import { afterEach, describe, expect, it, vi } from "vitest";
import { embeddedFontCss, fontUsage, hasIconGlyphs, type TextRun } from "./fonts.ts";

function run(text: string, overrides: Partial<TextRun> = {}): TextRun {
  return { text, bold: false, italic: false, ...overrides };
}

/** Codepoint as a string, so a test never depends on this file's own encoding. */
const cp = (code: number) => String.fromCodePoint(code);

describe("hasIconGlyphs", () => {
  it("finds the private-use codepoints the icon face carries", () => {
    expect(hasIconGlyphs(cp(0xe0b0))).toBe(true); // powerline separator
    expect(hasIconGlyphs(cp(0xe0a0))).toBe(true); // git branch
    expect(hasIconGlyphs(cp(0xf07b))).toBe(true); // font awesome folder
    expect(hasIconGlyphs(cp(0xf0004))).toBe(true); // material design, supplementary PUA
    expect(hasIconGlyphs(`~/dev/boron ${cp(0xe0b0)} main`)).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(hasIconGlyphs("")).toBe(false);
    expect(hasIconGlyphs("$ npm run build")).toBe(false);
    expect(hasIconGlyphs("╭───────╮ ➜ ✓ ✗ ⚠ █")).toBe(false);
    expect(hasIconGlyphs("Ω ℂ é Ж α")).toBe(false);
  });

  /**
   * The whole point of testing the PUA rather than "U+E000 and above". An emoji
   * or a CJK character is numerically past U+E000 but is not in the icon face,
   * and U+FFFD is what a paste of undecodable bytes is full of — pulling 880 KB
   * for any of them would be a slow, invisible tax on documents with no icons.
   */
  it("does not mistake other high codepoints for icons", () => {
    expect(hasIconGlyphs("🚀")).toBe(false);
    expect(hasIconGlyphs("中")).toBe(false);
    expect(hasIconGlyphs("�")).toBe(false);
  });
});

describe("fontUsage", () => {
  it("reports only the faces that are actually painted with", () => {
    const usage = fontUsage([run("plain"), run("bold", { bold: true })]);
    expect(usage.faces.map((face) => `${face.weight} ${face.style}`)).toEqual(["400 normal", "700 normal"]);
    expect(usage.icons).toBe(false);
  });

  it("orders faces by declaration, not by the order the document used them", () => {
    const forwards = fontUsage([run("a"), run("b", { bold: true, italic: true })]);
    const backwards = fontUsage([run("b", { bold: true, italic: true }), run("a")]);
    expect(forwards.faces).toEqual(backwards.faces);
  });

  it("ignores empty runs, which would otherwise pull in a face nothing draws", () => {
    expect(fontUsage([run(""), run("", { italic: true }), run("x")]).faces).toHaveLength(1);
  });

  it("flags icons from any run, not just the first", () => {
    expect(fontUsage([run("plain"), run(cp(0xe0b0))]).icons).toBe(true);
    expect(fontUsage([run("plain"), run("also plain")]).icons).toBe(false);
  });
});

describe("embeddedFontCss", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFontBytes(): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([0x77, 0x4f, 0x46, 0x32]))),
    );
  }

  it("inlines one @font-face per used face and no others", async () => {
    stubFontBytes();
    const css = await embeddedFontCss(fontUsage([run("plain")]));
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).toContain("data:font/woff2;base64,");
    expect(css).toContain('font-family: "Boron Mono"');
    expect(css).not.toContain("Boron Icons");
  });

  /**
   * The size claim this whole split exists for: a document with no icon in it
   * must not carry the 880 KB icon face, which is 4x everything else combined.
   */
  it("only inlines the icon face when the document uses one", async () => {
    stubFontBytes();
    const without = await embeddedFontCss(fontUsage([run("$ npm run build")]));
    expect(without).not.toContain("Boron Icons");

    const with_ = await embeddedFontCss(fontUsage([run(`main ${cp(0xe0b0)}`)]));
    expect(with_).toContain('font-family: "Boron Icons"');
    // One rule for every weight, because the patched outlines are identical
    // across all four source faces.
    expect(with_.match(/font-family: "Boron Icons"/g)).toHaveLength(1);
    expect(with_).toContain("font-weight: 100 900");
  });
});
