import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi.ts";
import { autoHighlight, detectLanguage, highlightToAnsi } from "./highlight.ts";
import { isNamedColor } from "./types.ts";

const TS = [
  "export function classify(texts: readonly string[]): Line[] {",
  "  const result: Line[] = [];",
  "  let continuing = false;",
  "  for (const text of texts) {",
  '    if (continuing) { result.push({ kind: "command" }); continue; }',
  "  }",
  "  return result;",
  "}",
].join("\n");

const PYTHON = [
  "def parse_ansi(text: str) -> list[Cell]:",
  "    cells = []",
  "    for ch in text:",
  '        if ch == "x":',
  "            continue",
  "        cells.append(Cell(ch))",
  "    return cells",
].join("\n");

const GO = ["func main() {", "\tcells := make([]Cell, 0)", "\tfor _, ch := range text {", "\t}", "}"].join("\n");

describe("highlightToAnsi", () => {
  it("colors only with the sixteen names, never hex or a 256 index", () => {
    for (const line of parseAnsi(highlightToAnsi(TS, "typescript"))) {
      for (const span of line.spans) {
        if (span.marks.fg === undefined) continue;
        expect(isNamedColor(span.marks.fg), `${span.marks.fg} is not one of the sixteen`).toBe(true);
      }
    }
  });

  it("puts the keyword, the string and the comment in different colors", () => {
    const spans = parseAnsi(highlightToAnsi('const s = "hi"; // note', "typescript")).flatMap(
      (line) => line.spans,
    );
    const colorOf = (text: string) => spans.find((span) => span.text.includes(text))?.marks.fg;

    expect(colorOf("const")).toBe("magenta");
    expect(colorOf('"hi"')).toBe("green");
    expect(colorOf("// note")).toBe("blackBright");
  });

  it("leaves the text itself untouched", () => {
    const text = parseAnsi(highlightToAnsi(PYTHON, "python"))
      .map((line) => line.spans.map((span) => span.text).join(""))
      .join("\n");
    expect(text).toBe(PYTHON);
  });

  it("hands tabs to the parser, which expands them to eight-column stops", () => {
    // Go is written with real tabs, so the highlighter must not swallow them —
    // `parseAnsi` is the one place tab stops are decided.
    const rows = parseAnsi(highlightToAnsi(GO, "go"));
    const second = (rows[1]?.spans ?? []).map((span) => span.text).join("");
    expect(second.startsWith("        cells")).toBe(true);
  });
});

describe("detectLanguage", () => {
  it.each([
    ["typescript", TS],
    ["python", PYTHON],
    ["go", GO],
    ["json", '{\n  "name": "boron",\n  "version": "0.0.4",\n  "type": "module"\n}'],
    ["sql", "SELECT id, name\nFROM users\nWHERE created_at > NOW()\nORDER BY id DESC;"],
    ["yaml", "name: ci\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest"],
  ])("detects %s", (language, code) => {
    expect(detectLanguage(code)).toBe(language);
  });

  it("declines a terminal transcript, whatever a grammar scores it", () => {
    // The `$` prompt is the signal: this came off a terminal, so the colors are
    // not a highlighter's to invent.
    expect(detectLanguage("$ git status\nOn branch main\nnothing to commit")).toBeNull();
    expect(detectLanguage("❯ npm install\nadded 284 packages in 3s")).toBeNull();
  });

  it("declines prose and short fragments rather than guessing", () => {
    expect(detectLanguage("The quick brown fox jumps over the lazy dog.")).toBeNull();
    expect(detectLanguage("hello")).toBeNull();
    expect(detectLanguage("")).toBeNull();
  });

  it("declines plain command output with no prompt in it", () => {
    expect(detectLanguage("added 284 packages, and audited 285 packages in 3s")).toBeNull();
    expect(detectLanguage("AGENTS.md  README.md  dist  docs  index.html  package.json")).toBeNull();
  });

  /**
   * These are the samples that a wider grammar set gets wrong — `curl`'s meter
   * scores 12 as Ruby against all 190 grammars, and a stack trace 6 as PHP. They
   * are here so that widening `GRAMMARS` fails loudly rather than quietly
   * recoloring somebody's build log.
   */
  it("declines the output that a wider grammar set would misread", () => {
    expect(
      detectLanguage(
        "  % Total    % Received % Xferd  Average Speed\n100  1256  100  1256    0     0   8432      0 --:--:--",
      ),
    ).toBeNull();
    expect(
      detectLanguage(
        "TypeError: Cannot read properties of undefined\n    at parseAnsi (/app/src/core/ansi.ts:112:19)",
      ),
    ).toBeNull();
    expect(detectLanguage(" Test Files  2 passed (2)\n      Tests  35 passed (35)")).toBeNull();
  });
});

describe("autoHighlight", () => {
  it("returns the language alongside ANSI that re-parses to it", () => {
    const result = autoHighlight(TS);
    expect(result?.language).toBe("typescript");
    const colors = new Set(
      parseAnsi(result!.ansi)
        .flatMap((line) => line.spans)
        .map((span) => span.marks.fg)
        .filter((fg) => fg !== undefined),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("is null for anything it declines, so the paste lands untouched", () => {
    expect(autoHighlight("$ ls -la\ntotal 24")).toBeNull();
  });
});
