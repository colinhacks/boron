import { describe, expect, it } from "vitest";
import type { LineElement } from "./core/document.ts";
import { DEFAULT_THEME } from "./core/themes.ts";
import { DEFAULT_BACKGROUND_ID } from "./export/background.ts";
import { DEFAULT_FRAME } from "./export/layout.ts";
import { buildShareUrl, decodeShare, encodeShare, shareParamFrom } from "./share.ts";
import type { Workspace } from "./workspace.ts";

const frame = {
  framePadding: 96,
  radius: 4,
  showChrome: true,
  title: "zsh — boron",
  shadowStrength: 30,
  columns: 64,
};

const workspace: Workspace = {
  document: [
    { type: "line", children: [{ text: "$ npm run build" }] },
    { type: "line", children: [{ text: "built in 1.2s", fg: "green", bold: true }] },
  ],
  themeId: "dracula",
  backgroundId: "ember",
  frame,
};

describe("encodeShare / decodeShare", () => {
  it("round-trips a whole workspace", async () => {
    expect(await decodeShare(await encodeShare(workspace))).toEqual(workspace);
  });

  it("compresses, and stays inside a URL-safe alphabet", async () => {
    const payload = await encodeShare(workspace);
    expect(payload.slice(0, 1)).toBe("z");
    expect(payload.slice(1)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("shortens rather than grows on repetitive output", async () => {
    const repetitive: Workspace = {
      ...workspace,
      document: Array.from({ length: 40 }, (): LineElement => ({
        type: "line",
        children: [{ text: "npm warn deprecated something@1.0.0", fg: "yellow" }],
      })),
    };
    const payload = await encodeShare(repetitive);
    expect(payload.length).toBeLessThan(JSON.stringify(repetitive).length / 4);
  });

  it("reads a payload written without a compressor", async () => {
    // What a script that has terminal output and nothing else would emit.
    const wire = { version: 1, content: "$ ls\na.txt", theme: "nord" };
    const bytes = new TextEncoder().encode(JSON.stringify(wire));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const payload = `u${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

    const restored = await decodeShare(payload);
    expect(restored?.themeId).toBe("nord");
    expect(restored?.document).toEqual([
      { type: "line", children: [{ text: "$ ls" }] },
      { type: "line", children: [{ text: "a.txt" }] },
    ]);
    expect(restored?.frame).toEqual(DEFAULT_FRAME);
    expect(restored?.backgroundId).toBe(DEFAULT_BACKGROUND_ID);
  });

  it("rejects what isn't a payload", async () => {
    expect(await decodeShare("")).toBeNull();
    expect(await decodeShare("znot-base64-at-all-!!")).toBeNull();
    expect(await decodeShare(`u${btoa("{ not json")}`)).toBeNull();
    // Right flag, bytes that are not DEFLATE.
    expect(await decodeShare("zaGVsbG8")).toBeNull();
    // A payload the wire format refuses.
    const bad = new TextEncoder().encode(JSON.stringify({ version: 2, content: "x" }));
    let binary = "";
    for (const b of bad) binary += String.fromCharCode(b);
    expect(await decodeShare(`u${btoa(binary)}`)).toBeNull();
  });

  /**
   * A short link must not be able to unpack into a document that hangs the tab —
   * the receiver has no say in what arrives.
   */
  it("refuses a decompression bomb", async () => {
    const wire = { version: 1, content: "hello\n".repeat(60000) };
    const bytes = new TextEncoder().encode(JSON.stringify(wire));
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    const chunks: Uint8Array[] = [];
    const reader = cs.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let length = 0;
    for (const c of chunks) length += c.length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    let binary = "";
    for (const b of out) binary += String.fromCharCode(b);
    const payload = `z${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

    expect(payload.length).toBeLessThan(1000);
    expect(await decodeShare(payload)).toBeNull();
  });
});

describe("the URL", () => {
  it("puts the payload in the query string, on a clean address", async () => {
    const url = await buildShareUrl(workspace, "https://boron.sh/?utm=x#s=stale");
    expect(url.startsWith("https://boron.sh/?s=")).toBe(true);
    expect(await decodeShare(shareParamFrom(url)!)).toEqual(workspace);
  });

  it("falls back to the fragment when the query string would get too long", async () => {
    const big: Workspace = {
      ...workspace,
      document: Array.from({ length: 400 }, (_, line): LineElement => ({
        type: "line",
        children: [{ text: `${line} ${Math.PI * line} ${(line * 2654435761) % 1000000}`.repeat(4) }],
      })),
    };
    const url = await buildShareUrl(big, "https://boron.sh/");
    expect(url.length).toBeGreaterThan(8000);
    expect(url).toContain("#s=");
    expect(url).not.toContain("?s=");
    expect(await decodeShare(shareParamFrom(url)!)).toEqual(big);
  });

  it("reads the payload from either half of a URL", () => {
    expect(shareParamFrom("https://boron.sh/?s=abc")).toBe("abc");
    expect(shareParamFrom("https://boron.sh/#s=abc")).toBe("abc");
    expect(shareParamFrom("https://boron.sh/")).toBeNull();
    expect(shareParamFrom("not a url")).toBeNull();
  });
});

/**
 * The corpus proves the *format* survives change. This proves a real link does —
 * the same payloads, taken all the way through an address and back.
 */
describe("the frozen corpus survives a round trip through a URL", () => {
  const payloads = [
    '{"version":1,"content":"$ ls\\na.txt"}',
    '{"version":1,"content":"\\u001b[1;32mPASS\\u001b[0m ok","theme":"nord","backdrop":"mint"}',
    '{"version":1,"content":"\\u001b[38;5;208m256\\u001b[0m \\u001b[38;2;10;200;30mtrue\\u001b[0m","theme":"dracula","backdrop":"none","frame":{"padding":64,"radius":8,"titleBar":true,"title":"zsh","shadow":50,"columns":40}}',
    '{"version":1,"content":"\\u001b[38;5;9ma\\u001b[0m\\u001b[38;5;16mb\\u001b[0m\\u001b[48;5;255mc\\u001b[0m"}',
    '{"version":1,"content":"padded     "}',
  ];

  for (const [index, wire] of payloads.entries()) {
    it(`payload ${index} survives encode → URL → decode`, async () => {
      const bytes = new TextEncoder().encode(wire);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const plain = `u${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

      const direct = await decodeShare(plain);
      expect(direct).not.toBeNull();

      const url = await buildShareUrl(direct!, "https://boron.sh/");
      expect(await decodeShare(shareParamFrom(url)!)).toEqual(direct);
    });
  }

  it("fills every setting, so a bare link renders the same for everyone", async () => {
    const bare = await decodeShare("u" + btoa('{"version":1,"content":"x"}'));
    expect(bare).not.toBeNull();
    const restored = await decodeShare(await encodeShare(bare!));
    expect(restored?.themeId).toBe(DEFAULT_THEME.id);
    expect(restored?.backgroundId).toBe(DEFAULT_BACKGROUND_ID);
    expect(restored?.frame).toEqual(DEFAULT_FRAME);
  });
});
