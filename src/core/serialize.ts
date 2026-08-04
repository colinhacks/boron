import { namedColorIndex, parseAnsi256, parseCssColor } from "./palette.ts";
import { effectiveMarks } from "./style.ts";
import type { Theme } from "./themes.ts";
import { isNamedColor, type Color, type Marks, type RenderLine } from "./types.ts";

const ESC = "\u001b";
const RESET = `${ESC}[0m`;

/** SGR parameters for a foreground color, or background when `background`. */
function colorCodes(color: Color, background: boolean): string[] {
  const base = background ? 40 : 30;
  if (isNamedColor(color)) {
    const index = namedColorIndex(color);
    return [String(index < 8 ? base + index : base + 60 + (index - 8))];
  }
  const ansi256 = parseAnsi256(color);
  if (ansi256 !== null) return [String(base + 8), "5", String(ansi256)];
  const rgb = parseCssColor(color);
  if (rgb) return [String(base + 8), "2", String(rgb.r), String(rgb.g), String(rgb.b)];
  return [];
}

/**
 * The SGR codes for a run, after the `$`-prompt heuristic's implied marks have
 * been merged in. Because the automatic styling *is* chalk marks, this is a
 * straight translation with no special cases — every pixel on screen has an
 * escape code behind it.
 */
function markCodes(marks: Marks): string[] {
  const codes: string[] = [];

  if (marks.bold === true) codes.push("1");
  if (marks.dim === true) codes.push("2");
  if (marks.italic === true) codes.push("3");
  if (marks.underline === true) codes.push("4");
  if (marks.inverse === true) codes.push("7");
  if (marks.hidden === true) codes.push("8");
  if (marks.strikethrough === true) codes.push("9");

  if (marks.fg !== undefined) codes.push(...colorCodes(marks.fg, false));
  if (marks.bg !== undefined) codes.push(...colorCodes(marks.bg, true));

  return codes;
}

export function toPlainText(lines: readonly RenderLine[]): string {
  return lines.map((line) => line.spans.map((span) => span.text).join("")).join("\n");
}

/** Terminal-ready text with escape sequences — paste this straight into a shell. */
export function toAnsi(lines: readonly RenderLine[], theme: Theme): string {
  return lines
    .map((line) =>
      line.spans
        .map((span) => {
          if (span.text.length === 0) return "";
          const codes = markCodes(effectiveMarks(span.marks, span.role, theme));
          if (codes.length === 0) return span.text;
          return `${ESC}[${codes.join(";")}m${span.text}${RESET}`;
        })
        .join(""),
    )
    .join("\n");
}

function chalkChain(marks: Marks): string[] {
  const chain: string[] = [];

  if (marks.bold === true) chain.push("bold");
  if (marks.dim === true) chain.push("dim");
  if (marks.italic === true) chain.push("italic");
  if (marks.underline === true) chain.push("underline");
  if (marks.inverse === true) chain.push("inverse");
  if (marks.hidden === true) chain.push("hidden");
  if (marks.strikethrough === true) chain.push("strikethrough");

  const colorCall = (color: Color, background: boolean): string => {
    const capitalize = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
    if (isNamedColor(color)) return background ? `bg${capitalize(color)}` : color;
    const ansi256 = parseAnsi256(color);
    if (ansi256 !== null) return background ? `bgAnsi256(${ansi256})` : `ansi256(${ansi256})`;
    return background ? `bgHex(${JSON.stringify(color)})` : `hex(${JSON.stringify(color)})`;
  };

  if (marks.fg !== undefined) chain.push(colorCall(marks.fg, false));
  if (marks.bg !== undefined) chain.push(colorCall(marks.bg, true));

  return chain;
}

/** A runnable chalk snippet — the fastest way to hand a mockup to an agent. */
export function toChalkSource(lines: readonly RenderLine[], theme: Theme): string {
  const body = lines
    .map((line) => {
      const parts = line.spans
        .filter((span) => span.text.length > 0)
        .map((span) => {
          const chain = chalkChain(effectiveMarks(span.marks, span.role, theme));
          const literal = JSON.stringify(span.text);
          return chain.length === 0 ? literal : `chalk.${chain.join(".")}(${literal})`;
        });
      return parts.length === 0 ? '  ""' : `  ${parts.join(" + ")}`;
    })
    .join(",\n");

  return `import chalk from "chalk";\n\nconsole.log(\n  [\n${body
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")},\n  ].join("\\n"),\n);\n`;
}
