import { describe, expect, it } from "vitest";
import {
  GHOSTTY_1_3_1,
  GHOSTTY_1_3_1_PLAIN,
  NUBJS_SHIKI_BLOCK,
  NUBJS_SHIKI_BLOCK_PLAIN,
  TERMINAL_APP_2_15,
} from "./clipboard-fixtures.ts";
import { parseHtmlClipboard } from "./html-paste.ts";
import { DEFAULT_THEME } from "./themes.ts";

const ansi16 = DEFAULT_THEME.ansi;

function shape(html: string) {
  return parseHtmlClipboard(html, ansi16)?.map((line) =>
    line.spans.map((span) => [span.text, span.marks] as const),
  );
}

describe("parseHtmlClipboard", () => {
  it("returns null for markup with no styling to preserve", () => {
    expect(parseHtmlClipboard("<div>plain text</div>", ansi16)).toBeNull();
    expect(parseHtmlClipboard("", ansi16)).toBeNull();
  });

  it("maps a known terminal palette color back onto its chalk name", () => {
    // #0dbc79 is VS Code's green, even though Boron's own green differs.
    expect(shape('<div><span style="color: #0dbc79">ok</span></div>')).toEqual([[["ok", { fg: "green" }]]]);
  });

  it("keeps an unrecognized color as a literal hex", () => {
    expect(shape('<div><span style="color: #7f3fbf">x</span></div>')).toEqual([[["x", { fg: "#7f3fbf" }]]]);
  });

  it("treats the wrapper's own foreground as unstyled so the prompt heuristic still applies", () => {
    const html =
      '<div style="color: #cccccc; background-color: #1f1f1f; white-space: pre;">' +
      "<div><span style=\"color: #cccccc;\">$ ls</span></div>" +
      '<div><span style="color: #0dbc79;">a.txt</span></div>' +
      "</div>";
    expect(shape(html)).toEqual([[["$ ls", {}]], [["a.txt", { fg: "green" }]]]);
  });

  it("reads bold, italic, underline and strikethrough from tags and styles", () => {
    expect(shape("<div><b>b</b><i>i</i><u>u</u><s>s</s><span style=\"color:#cd3131\">r</span></div>")).toEqual([
      [
        ["b", { bold: true }],
        ["i", { italic: true }],
        ["u", { underline: true }],
        ["s", { strikethrough: true }],
        ["r", { fg: "red" }],
      ],
    ]);
  });

  it("reads a numeric font-weight as bold", () => {
    expect(shape('<div><span style="font-weight: 700; color:#cd3131">x</span></div>')).toEqual([
      [["x", { fg: "red", bold: true }]],
    ]);
  });

  it("reads reduced opacity as dim, which is how several terminals render SGR 2", () => {
    expect(shape('<div><span style="opacity: 0.6; color:#cd3131">x</span></div>')).toEqual([
      [["x", { fg: "red", dim: true }]],
    ]);
  });

  it("breaks lines on <br> and on block elements", () => {
    expect(shape('<span style="color:#cd3131">a</span><br><span style="color:#0dbc79">b</span>')).toEqual([
      [["a", { fg: "red" }]],
      [["b", { fg: "green" }]],
    ]);
  });

  it("preserves runs of spaces inside white-space: pre", () => {
    const html = '<div style="white-space: pre;"><span style="color:#0dbc79">a    b</span></div>';
    expect(shape(html)).toEqual([[["a    b", { fg: "green" }]]]);
  });

  it("normalizes non-breaking spaces used for terminal padding", () => {
    const html = '<div><span style="color:#0dbc79">a&nbsp;&nbsp;b</span></div>';
    expect(shape(html)).toEqual([[["a  b", { fg: "green" }]]]);
  });

  it("drops markup indentation that is only source formatting", () => {
    const html = `<div>
      <span style="color:#0dbc79">ok</span>
    </div>`;
    expect(shape(html)).toEqual([[["ok", { fg: "green" }]]]);
  });

  it("ignores a background that merely repeats the wrapper's own", () => {
    const html =
      '<div style="background-color:#1e1e1e"><span style="background-color:#1e1e1e; color:#cd3131">x</span></div>';
    expect(shape(html)).toEqual([[["x", { fg: "red" }]]]);
  });

  it("keeps a run inline when the element says so, whatever its tag", () => {
    const html = '<div style="white-space: pre;"><div style="display: inline; color:#0dbc79">a</div>b</div>';
    expect(shape(html)).toEqual([[["a", { fg: "green" }], ["b", {}]]]);
  });

  it("breaks a line on a <span> that declares itself a block", () => {
    expect(shape('<span style="display: block; color:#cd3131">a</span><span style="color:#0dbc79">b</span>')).toEqual([
      [["a", { fg: "red" }]],
      [["b", { fg: "green" }]],
    ]);
  });

  it("drops a display: none run rather than inlining its text", () => {
    const html = '<div><span style="color:#0dbc79">a</span><span style="display:none">hidden</span></div>';
    expect(shape(html)).toEqual([[["a", { fg: "green" }]]]);
  });

  it("keeps a Ghostty row on one line instead of splitting it per styled run", () => {
    const lines = parseHtmlClipboard(GHOSTTY_1_3_1, ansi16)!;
    expect(lines.map((line) => line.spans.map((span) => span.text).join(""))).toEqual([
      "FRAY v0.1.5  ready in 2.9s",
      "",
      "  ➜  Local:   http://127.0.0.1:4919/",
      "   RED BG  plain italic strike",
      "256color truecolor trailing-plain",
    ]);
  });

  it("reads every mark Ghostty encodes onto a run", () => {
    const lines = parseHtmlClipboard(GHOSTTY_1_3_1, ansi16)!;
    const marksFor = (text: string) =>
      lines.flatMap((line) => line.spans).find((span) => span.text === text)?.marks;

    expect(marksFor("FRAY")).toEqual({ fg: "#b294bb", bold: true });
    expect(marksFor("v0.1.5")).toEqual({ dim: true });
    expect(marksFor("Local:")).toEqual({ bold: true });
    expect(marksFor("http://127.0.0.1:4919/")).toEqual({ fg: "#8abeb7", underline: true });
    expect(marksFor(" RED BG ")).toEqual({ fg: "whiteBright", bg: "#cc6666" });
    expect(marksFor("italic")).toEqual({ italic: true });
    expect(marksFor("strike")).toEqual({ strikethrough: true });
    expect(marksFor(" trailing-plain")).toEqual({});
  });

  it("reads styling out of a <style> block, not just the style attribute", () => {
    const html = '<style>.a { color: #cd3131 } .b { font-weight: bold }</style>' +
      '<div><span class="a">r</span><span class="b">b</span></div>';
    expect(shape(html)).toEqual([[["r", { fg: "red" }], ["b", { bold: true }]]]);
  });

  it("lets the style attribute outrank the stylesheet", () => {
    const html = '<style>span { color: #cd3131 }</style>' +
      '<div><span style="color: #0dbc79">x</span></div>';
    expect(shape(html)).toEqual([[["x", { fg: "green" }]]]);
  });

  it("orders competing rules by specificity rather than by source order", () => {
    const html = '<style>span.a { color: #0dbc79 } span { color: #cd3131 }</style>' +
      '<div><span class="a">x</span></div>';
    expect(shape(html)).toEqual([[["x", { fg: "green" }]]]);
  });

  it("keeps Terminal.app's rows whole, though it writes one <p> per row", () => {
    const lines = parseHtmlClipboard(TERMINAL_APP_2_15, ansi16)!;
    expect(lines.map((line) => line.spans.map((span) => span.text).join(""))).toEqual([
      "zshy git:(main) frizz-dev",
      "",
      "  FRIZZ v0.2.0  ready in 21s",
      "",
      "  ➜  Local:    http://127.0.0.1:4918/",
      "  ➜  Project:  zshy — ~/Documents/projects/zshy",
      "  ➜  Source:   ~/Documents/projects/fray",
      "  ➜  Logs:     ~/.frizz/projects/2c4cddd3-198f-4108-896f-a6dfa5440d8f/logs/frizz-2026-08-05T09-25-29-3704.log",
      "",
      "  press ctrl-c to stop · run with --debug for the full event feed",
    ]);
  });

  it("recovers the colors Terminal.app only ever states in class-based CSS", () => {
    const lines = parseHtmlClipboard(TERMINAL_APP_2_15, ansi16)!;
    const marksFor = (text: string) =>
      lines.flatMap((line) => line.spans).find((span) => span.text === text)?.marks;

    expect(marksFor("zshy")).toEqual({ fg: "cyan", bold: true });
    expect(marksFor("main")).toEqual({ fg: "red", bold: true });
    expect(marksFor("http://127.0.0.1:4918/")).toEqual({ fg: "cyan" });
  });

  it("treats the color Terminal.app puts on every row as no color at all", () => {
    const lines = parseHtmlClipboard(TERMINAL_APP_2_15, ansi16)!;
    const marksFor = (text: string) =>
      lines.flatMap((line) => line.spans).find((span) => span.text === text)?.marks;

    // Terminal.app hangs the profile's own foreground on each <p>. Taking it as
    // a mark would color every character and switch the prompt heuristic off.
    expect(marksFor("ready in 21s")).toEqual({});
    expect(marksFor("~/Documents/projects/fray")).toEqual({});
    expect(marksFor("press ctrl-c to stop · run with --debug for the full event feed")).toEqual({});
  });

  it("discounts the terminal background rather than painting it onto every run", () => {
    const lines = parseHtmlClipboard(TERMINAL_APP_2_15, ansi16)!;
    expect(lines.flatMap((line) => line.spans).every((span) => span.marks.bg === undefined)).toBe(true);
  });

  /**
   * A backdrop is discounted for being declared on a CONTAINER, never for being
   * a particular colour. A terminal that really does say `[40m` on one run
   * means it, and that run has to keep its black — so this is the control that
   * stops the rule above from becoming "drop black backgrounds".
   */
  it("keeps a background a run puts on itself, however dark", () => {
    const html =
      '<div style="color: rgb(255,255,255)">plain ' +
      '<span style="background-color: rgb(0,0,0)">on black</span>' +
      "</div>";
    const spans = parseHtmlClipboard(html, ansi16)!.flatMap((line) => line.spans);
    expect(spans.find((span) => span.text === "on black")?.marks).toEqual({ bg: "black" });
    expect(spans.find((span) => span.text === "plain ")?.marks).toEqual({});
  });

  /**
   * The other half of the same rule, and the reason it is stated as "a container
   * declared it" rather than "it is dark": a run wearing the very background its
   * container already set is not saying anything, so it is discounted too — and
   * markup that says nothing else at all falls through to plain text.
   */
  it("discounts a run's background when it only repeats the container's", () => {
    const html =
      '<div style="background-color: rgb(0,0,0); color: rgb(255,255,255)">' +
      '<span style="background-color: rgb(0,0,0)">on black</span>' +
      "</div>";
    expect(parseHtmlClipboard(html, ansi16)).toBeNull();
  });

  describe("a docs site's code block", () => {
    /**
     * Chrome omits `display` when it serializes computed styles to the clipboard,
     * so a `<span class="line">` made block by a stylesheet arrives inline and
     * the whole block reads as one row. 42 lines came through as one.
     */
    it("puts the rows back using the plain flavour the same copy carries", () => {
      const collapsed = parseHtmlClipboard(NUBJS_SHIKI_BLOCK, ansi16)!;
      expect(collapsed).toHaveLength(1);

      const lines = parseHtmlClipboard(NUBJS_SHIKI_BLOCK, ansi16, NUBJS_SHIKI_BLOCK_PLAIN)!;
      const text = lines.map((line) => line.spans.map((span) => span.text).join(""));
      expect(lines).toHaveLength(42);
      // Character for character, indentation and box drawing included.
      expect(text.join("\n")).toBe(NUBJS_SHIKI_BLOCK_PLAIN.replace(/\n+$/, ""));
      expect(text[2]).toBe("  // ── runtime — file runs, scripts, and watch mode ──");
    });

    /** The page's own background, which is not something the author said. */
    it("does not paint the page background onto every character", () => {
      const lines = parseHtmlClipboard(NUBJS_SHIKI_BLOCK, ansi16, NUBJS_SHIKI_BLOCK_PLAIN)!;
      const spans = lines.flatMap((line) => line.spans);
      expect(spans.every((span) => span.marks.bg === undefined)).toBe(true);
      // The syntax colouring is the part worth keeping, and it survives.
      expect(spans.some((span) => span.marks.fg !== undefined)).toBe(true);
    });

    /**
     * The repair only fires where the two flavours agree, so it cannot invent a
     * break in markup that already knew where its rows were.
     */
    it("leaves markup alone when the plain flavour describes something else", () => {
      const lines = parseHtmlClipboard(NUBJS_SHIKI_BLOCK, ansi16, "something else entirely")!;
      expect(lines).toHaveLength(1);
    });

    it("changes nothing for a terminal whose rows already parse", () => {
      const withPlain = parseHtmlClipboard(GHOSTTY_1_3_1, ansi16, GHOSTTY_1_3_1_PLAIN);
      expect(withPlain).toEqual(parseHtmlClipboard(GHOSTTY_1_3_1, ansi16));
    });

    /**
     * The rule itself, stated without reference to any one site's bytes: rows
     * that arrive as bare inline spans are recovered from the plain flavour, and
     * a run keeps the styling the markup gave it across the break. The fixture
     * above proves this happens in the wild; this proves what the rule *is*, so
     * neither can quietly stop meaning the other.
     */
    it("recovers rows from any markup that lost them, keeping each run's marks", () => {
      const html =
        '<span style="color: rgb(255,255,255)"><span style="color: rgb(255,0,0)">red</span>tail</span>' +
        '<span style="color: rgb(255,255,255)"><span style="color: rgb(0,0,255)">blue</span></span>';
      const lines = parseHtmlClipboard(html, ansi16, "redtail\nblue")!;
      expect(lines.map((line) => line.spans.map((span) => span.text).join(""))).toEqual(["redtail", "blue"]);
      // Pure `rgb(255,0,0)` is the palette's BRIGHT red, not its red.
      expect(lines[0]!.spans.find((span) => span.text === "red")?.marks).toEqual({ fg: "redBright" });
      expect(lines[1]!.spans.find((span) => span.text === "blue")?.marks).toEqual({ fg: "blue" });
      // And the container's own white stays "no colour at all" across the break.
      expect(lines[0]!.spans.find((span) => span.text === "tail")?.marks).toEqual({});
    });

    /** A break that falls INSIDE a styled run still cuts it, marks intact on both halves. */
    it("cuts a run that straddles a row boundary", () => {
      const html = '<span style="color: rgb(255,0,0)">abcd</span>';
      const lines = parseHtmlClipboard(html, ansi16, "ab\ncd")!;
      expect(lines.map((line) => line.spans.map((span) => span.text).join(""))).toEqual(["ab", "cd"]);
      expect(lines.every((line) => line.spans.every((span) => span.marks.fg === "redBright"))).toBe(true);
    });
  });
});
