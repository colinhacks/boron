import { describe, expect, it } from "vitest";
import type { LineElement } from "./core/document.ts";
import { DEFAULT_THEME } from "./core/themes.ts";
import { DEFAULT_BACKGROUND_ID, TRANSPARENT_ID } from "./export/background.ts";
import { DEFAULT_FRAME } from "./export/layout.ts";
import { PARAM, fromSearchParams, fromWire, toSearchParams, toWire, type WireWorkspaceV1 } from "./wire.ts";
import type { Workspace } from "./workspace.ts";

const E = "\u001b";

const frame = {
  framePadding: 96,
  radius: 4,
  showChrome: true,
  title: "zsh — boron",
  shadowStrength: 30,
  columns: 64,
  aspect: null,
};

function workspaceOf(document: LineElement[]): Workspace {
  return { document, themeId: "dracula", backgroundId: "ember", frame, highlight: "ansi" };
}

/* ------------------------------------------------------------ round trip -- */

describe("toWire / fromWire", () => {
  it("round-trips a whole workspace", () => {
    const workspace = workspaceOf([
      { type: "line", children: [{ text: "$ npm run build" }] },
      { type: "line", children: [{ text: "built in 1.2s", fg: "green", bold: true }] },
    ]);
    expect(fromWire(toWire(workspace))).toEqual(workspace);
  });

  it("round-trips every mark and every colour form", () => {
    const workspace = workspaceOf([
      {
        type: "line",
        children: [
          { text: "a", fg: "greenBright", bg: "ansi256:236" },
          { text: "b", bold: true, dim: true, italic: true, underline: true },
          { text: "c", strikethrough: true, inverse: true, hidden: true },
          { text: "d", fg: "#1e3a8a" },
        ],
      },
    ]);
    expect(fromWire(toWire(workspace))).toEqual(workspace);
  });

  /**
   * The heuristic is a rendering decision that recomputes from the text. Baked
   * into the wire it would freeze one reading: edit the first line so it is no
   * longer a command and everything under it would stay explicitly dimmed.
   */
  it("does not bake the prompt heuristic into the content", () => {
    const wire = toWire(
      workspaceOf([
        { type: "line", children: [{ text: "$ ls" }] },
        { type: "line", children: [{ text: "a.txt" }] },
      ]),
    );
    expect(wire.content).toBe("$ ls\na.txt");
    expect(fromWire(wire)?.document).toEqual([
      { type: "line", children: [{ text: "$ ls" }] },
      { type: "line", children: [{ text: "a.txt" }] },
    ]);
  });

  /** Trailing spaces take up cells, so losing them moves where a long line wraps. */
  it("keeps trailing spaces, which a paste would drop", () => {
    const workspace = workspaceOf([{ type: "line", children: [{ text: "padded     " }] }]);
    expect(fromWire(toWire(workspace))?.document).toEqual(workspace.document);
  });

  it("keeps a transparent backdrop transparent", () => {
    const workspace = { ...workspaceOf([{ type: "line", children: [{ text: "x" }] }]), backgroundId: TRANSPARENT_ID };
    expect(fromWire(toWire(workspace))?.backgroundId).toBe(TRANSPARENT_ID);
  });

  /**
   * A fill rides the field the backdrop ids already ride, which is why it is not
   * a v2 — but a `#` is the one character a query string will not carry as
   * itself, so the whole trip is pinned rather than just `fromWire`.
   */
  it("carries a fill colour through the wire and through a query string", () => {
    const workspace = { ...workspaceOf([{ type: "line", children: [{ text: "x" }] }]), backgroundId: "#ff6600" };
    const wire = toWire(workspace);
    expect(wire.backdrop).toBe("#ff6600");
    expect(fromWire(wire)?.backgroundId).toBe("#ff6600");

    const params = new URLSearchParams(toSearchParams(wire, "uXXXX").toString());
    expect(params.get(PARAM.backdrop)).toBe("#ff6600");
    expect(fromWire(fromSearchParams(params, wire.content))?.backgroundId).toBe("#ff6600");
  });

  it("carries an aspect through the wire and through a query string", () => {
    const pinned = { ...workspaceOf([{ type: "line", children: [{ text: "x" }] }]), frame: { ...frame, aspect: "og" } };
    const wire = toWire(pinned);
    expect(wire.frame?.aspect).toBe("og");
    expect(fromWire(wire)?.frame.aspect).toBe("og");
    expect(fromWire(fromSearchParams(toSearchParams(wire, "u"), wire.content))?.frame.aspect).toBe("og");
  });

  it("says nothing about an aspect when there is none, and reads an unknown one as none", () => {
    // Absent and "free-sized" are the same statement, so there is no id to write.
    expect(toWire(workspaceOf([{ type: "line", children: [{ text: "x" }] }])).frame).not.toHaveProperty("aspect");
    expect(fromWire({ version: 1, content: "x", frame: { aspect: "billboard" } })?.frame.aspect).toBeNull();
  });

  it("names nothing from the internal model in the payload", () => {
    const wire = toWire(workspaceOf([{ type: "line", children: [{ text: "x" }] }]));
    const keys = [...Object.keys(wire), ...Object.keys(wire.frame ?? {})];
    // The internal names are the ones that must never appear on the wire. The
    // width is not among them: `columns` is what the reader calls it and what
    // the app now calls it too, which is the wire name being right rather than
    // the guard being missing.
    for (const leaked of ["framePadding", "showChrome", "shadowStrength", "children", "themeId", "backgroundId"]) {
      expect(keys, `${leaked} leaked into the wire format`).not.toContain(leaked);
    }
  });
});

/* ---------------------------------------------------------- what it fills -- */

describe("fromWire defaults and rejection", () => {
  it("fills in every setting a sparse payload leaves out", () => {
    const restored = fromWire({ version: 1, content: "hello" });
    expect(restored?.themeId).toBe(DEFAULT_THEME.id);
    expect(restored?.backgroundId).toBe(DEFAULT_BACKGROUND_ID);
    expect(restored?.frame).toEqual(DEFAULT_FRAME);
  });

  it("refuses anything that is not a v1 payload", () => {
    expect(fromWire(null)).toBeNull();
    expect(fromWire("nope")).toBeNull();
    expect(fromWire({ content: "x" })).toBeNull();
    expect(fromWire({ version: 2, content: "x" })).toBeNull();
    expect(fromWire({ version: 1 })).toBeNull();
    expect(fromWire({ version: 1, content: 42 })).toBeNull();
  });

  it("drops a mark that has no escape code behind it", () => {
    // Reaches the document only through the ANSI parser, which cannot express
    // one — but the sanitizer is what guarantees it, so check the guarantee.
    const restored = fromWire({ version: 1, content: `${E}[31mred${E}[0m` });
    expect(restored?.document).toEqual([{ type: "line", children: [{ text: "red", fg: "red" }] }]);
  });

  it("clamps a frame that would take the layout somewhere silly", () => {
    const restored = fromWire({
      version: 1,
      content: "x",
      frame: { padding: 1e9, radius: -40, shadow: 900, columns: 0.5 },
    });
    expect(restored?.frame).toMatchObject({ framePadding: 400, radius: 0, shadowStrength: 100, columns: 1 });
  });
});

/* -------------------------------------------------------- the frozen corpus -- */

/**
 * Real payloads, written out by hand and **never regenerated**.
 *
 * This is the mechanism that makes back compatibility enforced rather than
 * remembered. Every entry is a link that could be out in the world; if a change
 * to the model, the parser or the sanitizers alters what one of them decodes to,
 * this fails — which is the only warning anyone gets, because the people holding
 * those links will never read a changelog.
 *
 * [src/core/clipboard-fixtures.ts](./core/clipboard-fixtures.ts) applies the same
 * discipline to real clipboard bytes for the same reason: invented data only
 * tests your imagination.
 *
 * Adding an entry is always fine. Editing one means you have broken a link.
 */
const CORPUS: readonly { name: string; payload: string; expect: Partial<Workspace> }[] = [
  {
    name: "bare content, everything else defaulted",
    payload: '{"version":1,"content":"$ ls\\na.txt"}',
    expect: {
      document: [
        { type: "line", children: [{ text: "$ ls" }] },
        { type: "line", children: [{ text: "a.txt" }] },
      ],
      themeId: DEFAULT_THEME.id,
      backgroundId: DEFAULT_BACKGROUND_ID,
      frame: DEFAULT_FRAME,
    },
  },
  {
    name: "named colour and a modifier",
    payload: '{"version":1,"content":"\\u001b[1;32mPASS\\u001b[0m ok","theme":"nord","backdrop":"mint"}',
    expect: {
      document: [
        {
          type: "line",
          children: [
            { text: "PASS", fg: "green", bold: true },
            { text: " ok" },
          ],
        },
      ],
      themeId: "nord",
      backgroundId: "mint",
    },
  },
  {
    name: "256 and truecolour, with a full frame",
    payload:
      '{"version":1,"content":"\\u001b[38;5;208m256\\u001b[0m \\u001b[38;2;10;200;30mtrue\\u001b[0m",' +
      '"theme":"dracula","backdrop":"none",' +
      '"frame":{"padding":64,"radius":8,"titleBar":true,"title":"zsh","shadow":50,"columns":40}}',
    expect: {
      document: [
        {
          type: "line",
          children: [
            { text: "256", fg: "ansi256:208" },
            { text: " " },
            { text: "true", fg: "#0ac81e" },
          ],
        },
      ],
      themeId: "dracula",
      backgroundId: "none",
      frame: {
        framePadding: 64,
        radius: 8,
        showChrome: true,
        title: "zsh",
        shadowStrength: 50,
        columns: 40,
        aspect: null,
      },
    },
  },
  {
    // The 0-15 band comes back under its chalk name and 16+ stays indexed, so
    // both sides of that boundary need a link holding them in place.
    name: "256-colour either side of the named/indexed boundary",
    payload: '{"version":1,"content":"\\u001b[38;5;9ma\\u001b[0m\\u001b[38;5;16mb\\u001b[0m\\u001b[48;5;255mc\\u001b[0m"}',
    expect: {
      document: [
        {
          type: "line",
          children: [
            { text: "a", fg: "redBright" },
            { text: "b", fg: "ansi256:16" },
            { text: "c", bg: "ansi256:255" },
          ],
        },
      ],
    },
  },
  {
    name: "a retired theme id degrades to the default rather than failing",
    payload: '{"version":1,"content":"x","theme":"no-such-theme-any-more","backdrop":"no-such-backdrop"}',
    expect: {
      document: [{ type: "line", children: [{ text: "x" }] }],
      themeId: DEFAULT_THEME.id,
      backgroundId: DEFAULT_BACKGROUND_ID,
    },
  },
];

describe("the frozen v1 corpus", () => {
  for (const entry of CORPUS) {
    it(`still decodes: ${entry.name}`, () => {
      const restored = fromWire(JSON.parse(entry.payload) as WireWorkspaceV1);
      expect(restored).not.toBeNull();
      expect(restored).toMatchObject(entry.expect);
    });
  }

  it("still re-encodes each one to something that decodes the same", () => {
    for (const entry of CORPUS) {
      const once = fromWire(JSON.parse(entry.payload) as WireWorkspaceV1)!;
      expect(fromWire(toWire(once)), entry.name).toEqual(once);
    }
  });
});

/* ------------------------------------------------------ as query params -- */

describe("toSearchParams / fromSearchParams", () => {
  const wireOf = (document: LineElement[]) => toWire(workspaceOf(document));

  it("writes one named parameter per setting", () => {
    const params = toSearchParams(wireOf([{ type: "line", children: [{ text: "x" }] }]), "uXXXX");
    expect([...params.keys()].sort()).toEqual(Object.values(PARAM).slice().sort());
    expect(params.get("theme")).toBe("dracula");
    expect(params.get("backdrop")).toBe("ember");
    expect(params.get("padding")).toBe("96");
    expect(params.get("columns")).toBe("64");
    expect(params.get("titleBar")).toBe("1");
    expect(params.get("content")).toBe("uXXXX");
  });

  /**
   * The same rule the blob had, and the same reason: a link is a promise about
   * an image, and one that repaints because a default moved has broken it. A
   * query string makes omitting them tempting in a way a blob did not.
   */
  it("writes settings that happen to equal a default, rather than omitting them", () => {
    const params = toSearchParams(toWire({ ...workspaceOf([{ type: "line", children: [{ text: "x" }] }]), frame: DEFAULT_FRAME }), "u");
    expect(params.get("padding")).toBe(String(DEFAULT_FRAME.framePadding));
    expect(params.get("shadow")).toBe(String(DEFAULT_FRAME.shadowStrength));
    expect(params.get("columns")).toBe(String(DEFAULT_FRAME.columns));
  });

  it("round-trips every setting through a query string", () => {
    const wire = wireOf([{ type: "line", children: [{ text: "x" }] }]);
    const back = fromSearchParams(toSearchParams(wire, "ignored"), wire.content);
    expect(fromWire(back)).toEqual(fromWire(wire));
  });

  it("defaults anything the link leaves out", () => {
    const restored = fromWire(fromSearchParams(new URLSearchParams("theme=nord"), "hello"));
    expect(restored?.themeId).toBe("nord");
    expect(restored?.backgroundId).toBe(DEFAULT_BACKGROUND_ID);
    expect(restored?.frame).toEqual(DEFAULT_FRAME);
  });

  /** Adding a setting must never break a link written before it existed. */
  it("ignores a parameter it does not know", () => {
    const restored = fromWire(fromSearchParams(new URLSearchParams("theme=nord&glow=17&utm_source=x"), "hi"));
    expect(restored?.themeId).toBe("nord");
    expect(restored?.frame).toEqual(DEFAULT_FRAME);
  });

  it("takes a missing version as the first one, and refuses a later one", () => {
    expect(fromSearchParams(new URLSearchParams("theme=nord"), "x")).not.toBeNull();
    expect(fromSearchParams(new URLSearchParams("v=1&theme=nord"), "x")).not.toBeNull();
    expect(fromSearchParams(new URLSearchParams("v=2&theme=nord"), "x")).toBeNull();
  });

  it("reads a boolean the way anyone would write one by hand", () => {
    const bar = (raw: string) => fromWire(fromSearchParams(new URLSearchParams(`titleBar=${raw}`), "x"))?.frame.showChrome;
    expect(bar("1")).toBe(true);
    expect(bar("true")).toBe(true);
    expect(bar("0")).toBe(false);
    expect(bar("false")).toBe(false);
  });

  it("falls back to the default rather than NaN when a number is nonsense", () => {
    const restored = fromWire(fromSearchParams(new URLSearchParams("padding=lots&radius=&columns=abc"), "x"));
    expect(restored?.frame.framePadding).toBe(DEFAULT_FRAME.framePadding);
    expect(restored?.frame.radius).toBe(DEFAULT_FRAME.radius);
    expect(restored?.frame.columns).toBe(DEFAULT_FRAME.columns);
  });

  it("still clamps what a hand-written link asks for", () => {
    const restored = fromWire(fromSearchParams(new URLSearchParams("padding=1e9&shadow=900&columns=0"), "x"));
    expect(restored?.frame).toMatchObject({ framePadding: 400, shadowStrength: 100, columns: 1 });
  });
});
