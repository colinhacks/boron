import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi.ts";
import { documentToRenderLines, parsedLinesToDocument, type LineElement } from "./document.ts";
import { toAnsi, toChalkSource, toPlainText } from "./serialize.ts";
import { resolveStyle } from "./style.ts";
import { THEMES, type Theme } from "./themes.ts";
import type { RenderLine } from "./types.ts";

const E = "\u001b";
const theme = THEMES[0]!;
const lightTheme = THEMES.find((candidate) => candidate.isLight)!;

function render(doc: LineElement[]) {
  return documentToRenderLines(doc);
}

describe("toAnsi", () => {
  it("bakes the prompt heuristic into escape codes", () => {
    const doc: LineElement[] = [
      { type: "line", children: [{ text: "$ ls" }] },
      { type: "line", children: [{ text: "a.txt" }] },
    ];
    expect(toAnsi(render(doc), theme)).toBe(`${E}[2m$ ${E}[0m${E}[97mls${E}[0m\n${E}[2ma.txt${E}[0m`);
  });

  it("uses black rather than an invisible bright white on a light theme", () => {
    const doc: LineElement[] = [{ type: "line", children: [{ text: "$ ls" }] }];
    expect(toAnsi(render(doc), lightTheme)).toBe(`${E}[2m$ ${E}[0m${E}[30mls${E}[0m`);
  });

  it("leaves a document with no commands unstyled", () => {
    const doc: LineElement[] = [{ type: "line", children: [{ text: "hello" }] }];
    expect(toAnsi(render(doc), theme)).toBe("hello");
  });

  it("keeps an explicitly colored output run at full intensity", () => {
    const doc: LineElement[] = [
      { type: "line", children: [{ text: "$ build" }] },
      { type: "line", children: [{ text: "ok", fg: "green" }] },
    ];
    expect(toAnsi(render(doc), theme)).toContain(`${E}[32mok${E}[0m`);
  });

  it("round-trips an explicit named color back to its SGR code", () => {
    const doc = parsedLinesToDocument(parseAnsi(`${E}[31mred${E}[0m`));
    expect(toAnsi(render(doc), theme)).toBe(`${E}[31mred${E}[0m`);
  });

  it("emits bright colors in the 90s range", () => {
    const doc = parsedLinesToDocument(parseAnsi(`${E}[92mok`));
    expect(toAnsi(render(doc), theme)).toBe(`${E}[92mok${E}[0m`);
  });

  it("emits extended and truecolor forms", () => {
    expect(toAnsi(render(parsedLinesToDocument(parseAnsi(`${E}[38;5;208mx`))), theme)).toBe(
      `${E}[38;5;208mx${E}[0m`,
    );
    expect(toAnsi(render(parsedLinesToDocument(parseAnsi(`${E}[38;2;255;136;0mx`))), theme)).toBe(
      `${E}[38;2;255;136;0mx${E}[0m`,
    );
  });

  it("orders modifiers before colors", () => {
    const doc = parsedLinesToDocument(parseAnsi(`${E}[1;4;31mx`));
    expect(toAnsi(render(doc), theme)).toBe(`${E}[1;4;31mx${E}[0m`);
  });

  it("emits background codes in the 40s range", () => {
    const doc = parsedLinesToDocument(parseAnsi(`${E}[41mx`));
    expect(toAnsi(render(doc), theme)).toBe(`${E}[41mx${E}[0m`);
  });
});

/** Per-character appearance, so the comparison survives different run boundaries. */
function appearance(lines: readonly RenderLine[], activeTheme: Theme) {
  return lines.map((line) =>
    line.spans.flatMap((span) => {
      const style = resolveStyle(span.marks, span.role, activeTheme);
      return Array.from(span.text, (character) => [
        character,
        style.color,
        style.background,
        style.bold,
        style.italic,
        style.underline,
        style.strikethrough,
        style.opacity,
      ]);
    }),
  );
}

/**
 * The load-bearing guarantee of the whole tool: nothing Boron draws is outside
 * what a terminal can print. Serializing to ANSI, parsing that back and
 * resolving it again must land on an identical appearance, character for
 * character — including the automatic `$`-prompt styling, which is exactly why
 * that styling is expressed as chalk marks rather than as arbitrary colors.
 */
describe("ANSI round-trip", () => {
  const cases: Record<string, LineElement[]> = {
    "auto-styled command and output": [
      { type: "line", children: [{ text: "colin@mac:~/code$ nub run build" }] },
      { type: "line", children: [{ text: "built in 1.2s" }] },
      { type: "line", children: [{ text: "" }] },
    ],
    "explicit palette colors": [
      { type: "line", children: [{ text: "$ test" }] },
      { type: "line", children: [{ text: "PASS", fg: "whiteBright", bg: "green" }, { text: " 42 ok" }] },
      { type: "line", children: [{ text: "warn", fg: "yellowBright", bold: true, underline: true }] },
    ],
    "extended and truecolor from a paste": parsedLinesToDocument(
      parseAnsi(`$ cargo test\n${E}[38;5;208mwarning${E}[0m: x\n${E}[38;2;120;200;255mblue${E}[0m`),
    ),
    "every modifier at once": [
      {
        type: "line",
        children: [
          {
            text: "loud",
            fg: "magenta",
            bg: "black",
            bold: true,
            italic: true,
            underline: true,
            strikethrough: true,
          },
        ],
      },
    ],
    "dim and inverse": [
      { type: "line", children: [{ text: "$ x" }] },
      { type: "line", children: [{ text: "faint", fg: "cyan", dim: true }, { text: "flip", inverse: true }] },
    ],
    "no commands at all": [{ type: "line", children: [{ text: "plain note" }] }],
  };

  for (const activeTheme of [theme, lightTheme]) {
    for (const [name, doc] of Object.entries(cases)) {
      it(`preserves appearance for ${name} on ${activeTheme.name}`, () => {
        const original = documentToRenderLines(doc);
        const reparsed = documentToRenderLines(parsedLinesToDocument(parseAnsi(toAnsi(original, activeTheme))));
        expect(appearance(reparsed, activeTheme)).toEqual(appearance(original, activeTheme));
      });
    }
  }
});

describe("toPlainText", () => {
  it("drops all styling", () => {
    const doc = parsedLinesToDocument(parseAnsi(`${E}[31mred${E}[0m\n$ ls`));
    expect(toPlainText(render(doc))).toBe("red\n$ ls");
  });
});

describe("toChalkSource", () => {
  it("produces a runnable chalk chain per run", () => {
    const doc: LineElement[] = [{ type: "line", children: [{ text: "$ ls" }] }];
    const source = toChalkSource(render(doc), theme);
    expect(source).toContain('import chalk from "chalk";');
    expect(source).toContain('chalk.dim("$ ") + chalk.whiteBright("ls")');
  });

  it("names background and extended colors with their chalk helpers", () => {
    const doc = parsedLinesToDocument(parseAnsi(`${E}[41;38;5;208mx`));
    expect(toChalkSource(render(doc), theme)).toContain("chalk.ansi256(208).bgRed");
  });
});
