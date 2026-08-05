import { describe, expect, it } from "vitest";
import { MAX_LINES, type LineElement } from "./core/document.ts";
import { DEFAULT_THEME } from "./core/themes.ts";
import { DEFAULT_BACKGROUND_ID, TRANSPARENT_ID } from "./export/background.ts";
import { DEFAULT_FRAME, MAX_TITLE_LENGTH } from "./export/layout.ts";
import {
  sanitizeBackgroundId,
  sanitizeDocument,
  sanitizeFrame,
  sanitizeThemeId,
  sanitizeWorkspace,
} from "./workspace.ts";

const document: LineElement[] = [
  { type: "line", children: [{ text: "$ npm run build" }] },
  { type: "line", children: [{ text: "built in 1.2s", fg: "green", bold: true }] },
];

describe("sanitizing", () => {
  it("clamps a frame that would take the layout somewhere silly", () => {
    expect(
      sanitizeFrame({ framePadding: 1e9, radius: -40, shadowStrength: 900, minColumns: 0.5 }),
    ).toEqual({
      ...DEFAULT_FRAME,
      framePadding: 400,
      radius: 0,
      shadowStrength: 100,
      minColumns: 1,
    });
  });

  it("falls back per field, not wholesale", () => {
    expect(sanitizeFrame({ radius: 20, title: 4 })).toEqual({ ...DEFAULT_FRAME, radius: 20 });
    expect(sanitizeFrame(null)).toEqual(DEFAULT_FRAME);
    expect(sanitizeFrame({ framePadding: Number.NaN }).framePadding).toBe(DEFAULT_FRAME.framePadding);
  });

  it("turns an unknown theme or backdrop into the default", () => {
    expect(sanitizeThemeId("no-such-theme")).toBe(DEFAULT_THEME.id);
    expect(sanitizeThemeId(12)).toBe(DEFAULT_THEME.id);
    expect(sanitizeBackgroundId("no-such-backdrop")).toBe(DEFAULT_BACKGROUND_ID);
    expect(sanitizeBackgroundId(TRANSPARENT_ID)).toBe(TRANSPARENT_ID);
    expect(sanitizeBackgroundId("mint")).toBe("mint");
  });

  it("rejects anything that is not a Slate document", () => {
    expect(sanitizeDocument([])).toBeNull();
    expect(sanitizeDocument("lines")).toBeNull();
    expect(sanitizeDocument([{ type: "paragraph", children: [{ text: "x" }] }])).toBeNull();
    expect(sanitizeDocument([{ type: "line", children: [{ bold: true }] }])).toBeNull();
    expect(sanitizeDocument(document)).toEqual(document);
  });

  it("gives a childless line the empty leaf Slate insists on", () => {
    expect(sanitizeDocument([{ type: "line", children: [] }])).toEqual([
      { type: "line", children: [{ text: "" }] },
    ]);
  });

  /**
   * The one property the whole tool rests on: everything Boron draws has to be
   * something a terminal could have printed. A URL is written by whoever sends
   * it, so this is the door that has to hold.
   */
  it("drops any mark that has no escape code behind it", () => {
    const smuggled = [
      {
        type: "line",
        children: [
          { text: "a", fg: "rebeccapurple" },
          { text: "b", bg: "oklch(0.7 0.1 200)" },
          { text: "c", fg: "url(https://example.com/x.png)" },
          { text: "d", fg: "#12345" },
          { text: "e", fg: "ansi256:256" },
          { text: "f", blink: true, fontSize: 96 },
          { text: "g", bold: "yes" },
        ],
      },
    ];
    expect(sanitizeDocument(smuggled)).toEqual([
      {
        type: "line",
        children: [
          { text: "a" },
          { text: "b" },
          { text: "c" },
          { text: "d" },
          { text: "e" },
          { text: "f" },
          { text: "g" },
        ],
      },
    ]);
  });

  it("keeps every color a terminal can actually be told", () => {
    const legal = [
      {
        type: "line",
        children: [
          { text: "a", fg: "greenBright" },
          { text: "b", bg: "ansi256:255" },
          { text: "c", fg: "ansi256:0" },
          { text: "d", fg: "#1e3a8a" },
          { text: "e", fg: "#abc" },
          { text: "f", bold: true, dim: true, italic: true, underline: true },
          { text: "g", strikethrough: true, inverse: true, hidden: true },
        ],
      },
    ];
    expect(sanitizeDocument(legal)).toEqual(legal);
  });

  /**
   * The block neither scrolls nor virtualizes, so every line is a real DOM node.
   * A stored workspace is the reader's own, but it is still bytes on disk that
   * something else could have written.
   */
  it("refuses more document than anyone meant", () => {
    const line = () => ({ type: "line", children: [{ text: "x" }] });
    expect(sanitizeDocument(Array.from({ length: MAX_LINES }, line))).toHaveLength(MAX_LINES);
    expect(sanitizeDocument(Array.from({ length: MAX_LINES + 1 }, line))).toBeNull();
  });

  it("clamps the title to what the sidebar can produce", () => {
    expect(sanitizeFrame({ title: "z".repeat(500) }).title).toHaveLength(MAX_TITLE_LENGTH);
  });

  it("holds that door for a whole workspace, not just a document", () => {
    const restored = sanitizeWorkspace(
      {
        document: [{ type: "line", children: [{ text: "hi", fg: "rebeccapurple", bold: true }] }],
        themeId: "nord",
        backgroundId: "mint",
        frame: { framePadding: 12 },
      },
      document,
    );
    expect(restored.document).toEqual([{ type: "line", children: [{ text: "hi", bold: true }] }]);
    expect(restored.themeId).toBe("nord");
    expect(restored.frame).toEqual({ ...DEFAULT_FRAME, framePadding: 12 });
  });
});
