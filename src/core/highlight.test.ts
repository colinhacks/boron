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

  /**
   * The restraint is the design, so it is what the tests are mostly about.
   * Nine established themes colour five or six categories and leave the rest as
   * ordinary text; a sheet that paints every scope highlight.js offers looks
   * like confetti, and nothing else in the suite would notice it happening.
   */
  describe("what is deliberately left unstyled", () => {
    const colorOf = (code: string, token: string, lang: Parameters<typeof highlightToAnsi>[1] = "typescript") =>
      parseAnsi(highlightToAnsi(code, lang))
        .flatMap((line) => line.spans)
        .find((span) => span.text.includes(token))?.marks.fg;

    it("leaves an object literal's keys as plain text", () => {
      expect(colorOf('const o = { name: "b", count: 42 };', "name")).toBeUndefined();
    });

    it("leaves plain variables and parameters as plain text", () => {
      expect(colorOf("const isoDate = other;", "isoDate")).toBeUndefined();
      expect(colorOf("function f(alpha) { return alpha; }", "alpha")).toBeUndefined();
    });

    it("leaves punctuation and operators as plain text", () => {
      expect(colorOf("const a = b + c;", " + ")).toBeUndefined();
    });

    it("still colours a config file's keys, where they are the structure", () => {
      expect(colorOf('{\n  "name": "boron"\n}', '"name"', "json")).toBe("cyan");
      expect(colorOf("name: ci\non:\n  push: 1", "name:", "yaml")).toBe("cyan");
    });
  });

  describe("the hues follow the established themes", () => {
    const colorOf = (code: string, token: string, lang: Parameters<typeof highlightToAnsi>[1] = "typescript") =>
      parseAnsi(highlightToAnsi(code, lang))
        .flatMap((line) => line.spans)
        .find((span) => span.text.includes(token))?.marks.fg;

    it("paints a class or type cyan rather than yellow", () => {
      // highlight.js scores "class" from capitalisation alone, so a plain
      // `const Event = …` lands here too — cyan reads as a type reference when
      // the guess is right and as nothing much when it is wrong.
      expect(colorOf("const d = new Date();", "Date")).toBe("cyan");
      expect(colorOf("const Event = make();", "Event")).toBe("cyan");
    });

    it("gives every constant one hue", () => {
      expect(colorOf("const a = 42;", "42")).toBe("yellow");
      expect(colorOf("const a = true;", "true")).toBe("yellow");
      expect(colorOf('{ "ok": true, "n": 1 }', "true", "json")).toBe(
        colorOf('{ "ok": true, "n": 1 }', "1", "json"),
      );
    });

    it("paints a function name blue at declaration and at the call site alike", () => {
      expect(colorOf("function render() {}", "render")).toBe("blue");
      expect(colorOf("thing.render();", "render")).toBe("blue");
    });

    it("treats `this` as the keyword it is", () => {
      expect(colorOf("class A { m() { return this.x; } }", "this")).toBe("magenta");
    });
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

/**
 * The corpus the detection thresholds were fitted to, and therefore their
 * specification. `MIN_RELEVANCE`, `MIN_TERMINATOR_RATIO` and
 * `MIN_PUNCTUATION_DENSITY` are hand-picked numbers; these two tables are what
 * says whether a change to any of them was an improvement or a regression.
 */
const REAL_CODE: Record<string, string> = {
  py_plain: "def parse_ansi(text):\n    cells = []\n    for ch in text:\n        cells.append(Cell(ch))\n    return cells",
  py_short: "x = [i for i in range(10)]\nprint(x)",
  py_class: "class Cell:\n    def __init__(self, ch):\n        self.ch = ch",
  ts_small: 'const parse = (s: string) => s.split("");\nexport default parse;',
  ts_iface: "interface Cell {\n  ch: string;\n  fg?: string;\n}",
  js_fn: "function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = add;",
  go_small: 'func main() {\n\tfmt.Println("hi")\n}',
  rust_small: 'fn main() {\n    println!("hi");\n}',
  json_small: '{\n  "name": "boron",\n  "version": "0.0.4"\n}',
  yaml_small: "name: ci\non:\n  push:\n    branches: [main]",
  bash_small: 'for f in src/*.ts; do\n  echo "$f"\ndone',
};

const REAL_OUTPUT: Record<string, string> = {
  npm: "added 284 packages, and audited 285 packages in 3s\n\nfound 0 vulnerabilities",
  vitest: " Test Files  2 passed (2)\n      Tests  35 passed (35)\n   Duration  512ms",
  git: "On branch main\nYour branch is up to date with 'origin/main'.\n\nnothing to commit, working tree clean",
  vite: "  VITE v8.2.0  ready in 214 ms\n\n  Local:   http://localhost:5173/\n  Network: use --host to expose",
  ls: "AGENTS.md  README.md  dist  docs  index.html  package.json  public  src  wiki",
  prose: "The quick brown fox jumps over the lazy dog. This is a sentence someone typed.",
  curl: "  % Total    % Received % Xferd  Average Speed\n100  1256  100  1256    0     0   8432      0 --:--:--",
  stack: "TypeError: Cannot read properties of undefined\n    at parseAnsi (/app/src/core/ansi.ts:112:19)\n    at handlePaste (/app/src/editor/paste.ts:44:7)",
  docker: "#8 [4/6] RUN npm ci\n#8 12.4 added 284 packages in 12s\n#8 DONE 12.9s",
  brew: "==> Downloading https://ghcr.io/v2/homebrew/core/librsvg\n==> Pouring librsvg--2.58.0.bottle.tar.gz",
  tree: "src\n├── core\n│   ├── ansi.ts\n│   └── document.ts\n└── editor\n    └── paste.ts",
  ps: "USER   PID  %CPU %MEM      VSZ    RSS   TT  STAT STARTED      TIME COMMAND\nroot     1   0.0  0.1  4382912  12800   ??  Ss   Mon10AM   0:42.11 /sbin/launchd",
  gh: "#391  Fix the cache collision      colin:fix-cache   OPEN\n#388  Pin the image to a canvas    colin:og-canvas   MERGED",
};

describe("the detection corpus", () => {
  it.each(Object.entries(REAL_CODE))("detects a language for %s", (_name, code) => {
    expect(detectLanguage(code)).not.toBeNull();
  });

  it.each(Object.entries(REAL_OUTPUT))("leaves %s alone", (_name, text) => {
    expect(detectLanguage(text)).toBeNull();
  });

  /**
   * The one known miss, pinned rather than hidden. Short SQL is punctuation-poor
   * (`SELECT id, name`) and scores 4, so it clears neither branch. Widening the
   * gate to catch it also catches `git status`, which is the worse trade.
   */
  it("misses short SQL, which is the accepted cost of the current gate", () => {
    expect(detectLanguage("SELECT id, name\nFROM users\nORDER BY id DESC;")).toBeNull();
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
