import { describe, expect, it } from "vitest";
import type { LineElement } from "./core/document.ts";
import { DEFAULT_THEME } from "./core/themes.ts";
import { DEFAULT_BACKGROUND_ID, TRANSPARENT_ID } from "./export/background.ts";
import { DEFAULT_FRAME, type FrameSettings } from "./export/layout.ts";
import {
  buildShareUrl,
  decodeWorkspace,
  encodeWorkspace,
  sanitizeBackgroundId,
  sanitizeDocument,
  sanitizeFrame,
  sanitizeThemeId,
  shareParamFrom,
  type Workspace,
} from "./workspace.ts";

const E = "\u001b";

const document: LineElement[] = [
  { type: "line", children: [{ text: "$ npm run build" }] },
  { type: "line", children: [{ text: "built in 1.2s", fg: "green", bold: true }] },
];

const frame: FrameSettings = {
  framePadding: 96,
  radius: 4,
  showChrome: false,
  title: "zsh — boron",
  shadowStrength: 30,
  minColumns: 64,
};

const workspace: Workspace = { document, themeId: "dracula", backgroundId: "ember", frame };

/** Base64url of a JSON payload — the form a script with no compressor writes. */
function plainPayload(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `u${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

describe("encodeWorkspace / decodeWorkspace", () => {
  it("round-trips a whole workspace", async () => {
    const decoded = await decodeWorkspace(await encodeWorkspace(workspace));
    expect(decoded).toEqual(workspace);
  });

  it("compresses, and stays inside a URL-safe alphabet", async () => {
    const payload = await encodeWorkspace(workspace);
    expect(payload.slice(0, 1)).toBe("z");
    expect(payload.slice(1)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload.length).toBeLessThan(JSON.stringify(workspace).length);
  });

  it("shortens rather than grows on repetitive output", async () => {
    const repetitive: Workspace = {
      ...workspace,
      document: Array.from({ length: 40 }, (): LineElement => ({
        type: "line",
        children: [{ text: "npm warn deprecated something@1.0.0", fg: "yellow" }],
      })),
    };
    const payload = await encodeWorkspace(repetitive);
    expect(payload.length).toBeLessThan(JSON.stringify(repetitive).length / 4);
  });

  it("carries every setting, so nothing falls back to a default on the way", async () => {
    const decoded = await decodeWorkspace(await encodeWorkspace(workspace));
    expect(decoded?.frame).toEqual(frame);
    expect(decoded?.themeId).toBe("dracula");
    expect(decoded?.backgroundId).toBe("ember");
  });

  it("keeps a transparent backdrop transparent", async () => {
    const decoded = await decodeWorkspace(
      await encodeWorkspace({ ...workspace, backgroundId: TRANSPARENT_ID }),
    );
    expect(decoded?.backgroundId).toBe(TRANSPARENT_ID);
  });

  it("reads an uncompressed payload, so a link can be written without a compressor", async () => {
    const decoded = await decodeWorkspace(plainPayload({ v: 1, doc: document, theme: "nord" }));
    expect(decoded?.document).toEqual(document);
    expect(decoded?.themeId).toBe("nord");
  });

  it("parses terminal output handed to it instead of a document", async () => {
    const decoded = await decodeWorkspace(
      plainPayload({ v: 1, ansi: `${E}[32mok${E}[0m\nsecond line` }),
    );
    expect(decoded?.document).toEqual([
      { type: "line", children: [{ text: "ok", fg: "green" }] },
      { type: "line", children: [{ text: "second line" }] },
    ]);
  });

  it("fills in every setting a sparse payload leaves out", async () => {
    const decoded = await decodeWorkspace(plainPayload({ v: 1, ansi: "hello" }));
    expect(decoded?.themeId).toBe(DEFAULT_THEME.id);
    expect(decoded?.backgroundId).toBe(DEFAULT_BACKGROUND_ID);
    expect(decoded?.frame).toEqual(DEFAULT_FRAME);
  });

  it("rejects what isn't a payload", async () => {
    expect(await decodeWorkspace("")).toBeNull();
    expect(await decodeWorkspace("znot-base64-at-all-!!")).toBeNull();
    expect(await decodeWorkspace(plainPayload({ v: 7, doc: document }))).toBeNull();
    expect(await decodeWorkspace(plainPayload(["not", "an", "object"]))).toBeNull();
    expect(await decodeWorkspace(`u${btoa("{ not json")}`)).toBeNull();
    // Right flag, but the bytes are not DEFLATE.
    expect(await decodeWorkspace("zaGVsbG8")).toBeNull();
  });
});

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

  it("holds that door on the way in from a link", async () => {
    const decoded = await decodeWorkspace(
      plainPayload({
        v: 1,
        doc: [{ type: "line", children: [{ text: "hi", fg: "rebeccapurple", bold: true }] }],
      }),
    );
    expect(decoded?.document).toEqual([{ type: "line", children: [{ text: "hi", bold: true }] }]);
  });
});

describe("the URL", () => {
  it("puts the payload in the fragment, on a clean address", async () => {
    const url = await buildShareUrl(workspace, "https://boron.sh/?utm=x#s=stale");
    expect(url.startsWith("https://boron.sh/#s=")).toBe(true);
    expect(await decodeWorkspace(url.split("#s=")[1]!)).toEqual(workspace);
  });

  it("reads the payload from either half of a URL", () => {
    expect(shareParamFrom("https://boron.sh/#s=abc")).toBe("abc");
    expect(shareParamFrom("https://boron.sh/?s=abc")).toBe("abc");
    expect(shareParamFrom("https://boron.sh/?s=query#s=fragment")).toBe("fragment");
    expect(shareParamFrom("https://boron.sh/")).toBeNull();
    expect(shareParamFrom("not a url")).toBeNull();
  });
});
