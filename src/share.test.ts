import { describe, expect, it } from "vitest";
import type { LineElement } from "./core/document.ts";
import { DEFAULT_THEME } from "./core/themes.ts";
import { DEFAULT_BACKGROUND_ID } from "./export/background.ts";
import { DEFAULT_FRAME } from "./export/layout.ts";
import {
  buildShareUrl,
  decodeContent,
  encodeContent,
  hasFragmentLink,
  readSharedWorkspace,
  shareParamsFrom,
  trackingUrl,
} from "./share.ts";
import type { Workspace } from "./workspace.ts";

const workspace: Workspace = {
  document: [
    { type: "line", children: [{ text: "$ npm run build" }] },
    { type: "line", children: [{ text: "built in 1.2s", fg: "green", bold: true }] },
  ],
  themeId: "dracula",
  backgroundId: "ember",
  frame: {
    framePadding: 96,
    radius: 4,
    showChrome: true,
    title: "zsh — boron",
    shadowStrength: 30,
    columns: 64,
    aspect: null,
  },
  highlight: "ansi",
};

/**
 * A workspace too big to fit in a query string.
 *
 * The rows are deliberately noisy. Five hundred copies of one line deflate down
 * to a few dozen bytes and sail comfortably under the ceiling — which is the
 * opposite of what a test about outgrowing it needs.
 */
const oversized: Workspace = {
  ...workspace,
  document: Array.from({ length: 500 }, (_, line): LineElement => ({
    type: "line",
    children: [{ text: `${line} ${Math.PI * line} ${(line * 2654435761) % 1000000}`.repeat(4) }],
  })),
};

describe("the content parameter", () => {
  it("round-trips, compressed", async () => {
    const encoded = await encodeContent("$ ls\na.txt");
    expect(encoded.slice(0, 1)).toBe("z");
    expect(encoded.slice(1)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeContent(encoded)).toBe("$ ls\na.txt");
  });

  it("reads the uncompressed form a script without a compressor writes", async () => {
    const ansi = "$ ls\na.txt";
    const bytes = new TextEncoder().encode(ansi);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const plain = `u${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    expect(await decodeContent(plain)).toBe(ansi);
  });

  it("refuses what is not content", async () => {
    expect(await decodeContent("")).toBeNull();
    expect(await decodeContent("znot base64 !!")).toBeNull();
    expect(await decodeContent("zaGVsbG8")).toBeNull();
    expect(await decodeContent("xabc")).toBeNull();
  });

  /** A short link must not unpack into something that hangs the tab. */
  it("refuses a decompression bomb", async () => {
    // Past MAX_DECOMPRESSED_BYTES: 1,000,000 rows is ~6MB unpacked.
    const bytes = new TextEncoder().encode("hello\n".repeat(1000000));
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

    // The point is the ratio, not the size: a link small enough to paste
    // anywhere unpacks into something no tab survives.
    expect(bytes.length / payload.length).toBeGreaterThan(100);
    expect(await decodeContent(payload)).toBeNull();
  });
});

describe("the URL", () => {
  it("is one readable parameter per setting", async () => {
    const url = await buildShareUrl(workspace, "https://boron.sh/?utm=x#stale");
    const params = new URL(url).searchParams;
    expect(url.startsWith("https://boron.sh/?")).toBe(true);
    expect(params.get("theme")).toBe("dracula");
    expect(params.get("backdrop")).toBe("ember");
    expect(params.get("padding")).toBe("96");
    expect(params.get("columns")).toBe("64");
    expect(params.get("title")).toBe("zsh — boron");
    expect(params.get("v")).toBe("1");
    // Only the content is opaque, and only because it is the part worth
    // compressing.
    expect(params.get("content")?.slice(0, 1)).toBe("z");
  });

  it("round-trips a whole workspace through an address", async () => {
    expect(await readSharedWorkspace(await buildShareUrl(workspace, "https://boron.sh/"))).toEqual(workspace);
  });

  it("falls back to the fragment when the query string would get too long", async () => {
    const url = await buildShareUrl(oversized, "https://boron.sh/");
    expect(url.length).toBeGreaterThan(8000);
    expect(url).toContain("#");
    expect(new URL(url).searchParams.has("content")).toBe(false);
    expect(await readSharedWorkspace(url)).toEqual(oversized);
  });

  it("reads from either half of a URL", async () => {
    const url = await buildShareUrl(workspace, "https://boron.sh/");
    const params = new URL(url).searchParams.toString();
    expect(await readSharedWorkspace(`https://boron.sh/?${params}`)).toEqual(workspace);
    expect(await readSharedWorkspace(`https://boron.sh/#${params}`)).toEqual(workspace);
  });

  it("is nothing when the URL carries no link", async () => {
    expect(shareParamsFrom("https://boron.sh/")).toBeNull();
    expect(shareParamsFrom("https://boron.sh/?theme=nord")).toBeNull();
    expect(await readSharedWorkspace("https://boron.sh/")).toBeNull();
    expect(await readSharedWorkspace("not a url")).toBeNull();
  });
});

/**
 * The address bar follows the workspace as it is edited, which is a different
 * job from making a link on demand: it happens constantly, and whatever it
 * leaves behind is what the next reload reads.
 */
describe("the address the bar tracks", () => {
  it("is the same link a copy would give, while one fits", async () => {
    expect(await trackingUrl(workspace, "https://boron.sh/")).toBe(
      await buildShareUrl(workspace, "https://boron.sh/"),
    );
  });

  it("round-trips, so a reload restores what was on screen", async () => {
    expect(await readSharedWorkspace(await trackingUrl(workspace, "https://boron.sh/"))).toEqual(workspace);
  });

  /**
   * The one place it parts company with a copied link. A stale URL is worse than
   * none: it beats `localStorage` on the next load, so leaving the last one that
   * fit would silently throw away the paste that outgrew it.
   */
  it("clears itself rather than going stale, once the workspace outgrows a query", async () => {
    const url = await trackingUrl(oversized, "https://boron.sh/?v=1&content=zabc&theme=nord");
    expect(url).toBe("https://boron.sh/");
    expect(await readSharedWorkspace(url)).toBeNull();

    // A copy of the same workspace still works — that is what the button is for.
    expect(await buildShareUrl(oversized, "https://boron.sh/")).toContain("#");
  });

  it("replaces what was already in the address rather than adding to it", async () => {
    const url = await trackingUrl(workspace, "https://boron.sh/?theme=dracula&utm=x#v=1&content=zabc");
    expect(url.includes("#")).toBe(false);
    expect(new URL(url).searchParams.get("theme")).toBe("dracula");
    expect(new URL(url).searchParams.getAll("theme")).toHaveLength(1);
    expect(new URL(url).searchParams.has("utm")).toBe(false);
  });
});

/**
 * Which half of a URL a link is in decides whether the app should reopen it.
 * The query string is the app's own writing; only a fragment is somebody else's.
 */
describe("a link in the fragment", () => {
  it("is told apart from the parameters the app writes itself", async () => {
    const tracked = await trackingUrl(workspace, "https://boron.sh/");
    expect(hasFragmentLink(tracked)).toBe(false);

    const copied = await buildShareUrl(oversized, "https://boron.sh/");
    expect(copied).toContain("#");
    expect(hasFragmentLink(copied)).toBe(true);
  });

  it("is nothing for a bare page, a bare fragment, or a non-URL", () => {
    expect(hasFragmentLink("https://boron.sh/")).toBe(false);
    expect(hasFragmentLink("https://boron.sh/#section")).toBe(false);
    expect(hasFragmentLink("not a url")).toBe(false);
  });
});

/**
 * The shape a generation endpoint will be handed, written the way somebody with
 * terminal output and a shell would write it: base64 the bytes, name the
 * settings, done. No JSON, no DEFLATE, no knowledge of anything internal.
 */
describe("a link written by hand", () => {
  const byHand = (ansi: string, rest: string) => {
    const bytes = new TextEncoder().encode(ansi);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    const content = `u${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    return `https://boron.sh/?content=${content}${rest}`;
  };

  it("needs only content", async () => {
    const restored = await readSharedWorkspace(byHand("$ ls\na.txt", ""));
    expect(restored?.document).toEqual([
      { type: "line", children: [{ text: "$ ls" }] },
      { type: "line", children: [{ text: "a.txt" }] },
    ]);
    expect(restored?.themeId).toBe(DEFAULT_THEME.id);
    expect(restored?.backgroundId).toBe(DEFAULT_BACKGROUND_ID);
    expect(restored?.frame).toEqual(DEFAULT_FRAME);
  });

  it("takes settings one at a time", async () => {
    const restored = await readSharedWorkspace(byHand("ok", "&theme=nord&padding=20&titleBar=0&columns=40"));
    expect(restored?.themeId).toBe("nord");
    expect(restored?.frame).toMatchObject({ framePadding: 20, showChrome: false, columns: 40 });
    // Everything unmentioned still defaults.
    expect(restored?.frame.radius).toBe(DEFAULT_FRAME.radius);
  });

  it("keeps the colours it was given", async () => {
    const E = "\u001b";
    const restored = await readSharedWorkspace(byHand(`${E}[1;32mPASS${E}[0m ok`, "&theme=nord"));
    expect(restored?.document).toEqual([
      { type: "line", children: [{ text: "PASS", fg: "green", bold: true }, { text: " ok" }] },
    ]);
  });
});
