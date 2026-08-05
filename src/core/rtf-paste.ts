import type { ParsedLine, ParsedSpan } from "./ansi.ts";
import { nearestPaletteColor, rgbToHex } from "./palette.ts";
import type { Color, Marks } from "./types.ts";

/**
 * Reading a terminal's `text/rtf` flavour directly, rather than through the
 * HTML someone converted it into.
 *
 * Worth having because the conversion Boron has been leaning on is not ours and
 * is not everywhere: Chrome synthesises HTML from RTF in `clipboard_mac.mm`, so
 * it happens on macOS and nowhere else. A terminal that writes RTF and no HTML
 * therefore arrives fully styled on a Mac and completely bare on Windows or
 * Linux — Windows Terminal's `copyFormatting: "rtf"` being the case that exists
 * in practice. Parsing it ourselves closes that gap and stops the feature
 * depending on a browser's platform-specific favour.
 *
 * Only as much of RTF 1.5 as terminal output actually uses. Terminals emit a
 * colour table and a flat run of styled text; they do not emit tables, lists,
 * embedded objects or style sheets, and none of that is handled here.
 */

interface RtfState {
  /** Index into the colour table. 0 is RTF's "auto", meaning no colour. */
  color: number;
  background: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** How many fallback characters follow a `\u`, per `\ucN`. */
  unicodeSkip: number;
}

interface RtfRun {
  text: string;
  state: RtfState;
}

const INITIAL: RtfState = {
  color: 0,
  background: 0,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  unicodeSkip: 1,
};

/**
 * Destinations whose contents are metadata rather than text.
 *
 * Anything introduced by `\*` is skipped wholesale as the spec requires, which
 * covers `\*\expandedcolortbl` and friends. These are the ones that carry no
 * such marker and would otherwise spill their innards into the document.
 */
const SKIPPED_DESTINATIONS = new Set([
  "fonttbl", "filetbl", "stylesheet", "listtable", "listoverridetable",
  "revtbl", "info", "pntext", "xmlnstbl",
]);

/** cp1252's upper half, which is where RTF's `\'hh` escapes land by default. */
const CP1252_HIGH = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

function fromCp1252(byte: number): string {
  if (byte >= 0x80 && byte <= 0x9f) return CP1252_HIGH[byte - 0x80] ?? "";
  return String.fromCharCode(byte);
}

/** The `\colortbl` entries, with index 0 left null for RTF's "auto". */
function parseColorTable(body: string): (string | null)[] {
  const colors: (string | null)[] = [];
  for (const entry of body.split(";")) {
    const red = /\\red(\d+)/.exec(entry);
    const green = /\\green(\d+)/.exec(entry);
    const blue = /\\blue(\d+)/.exec(entry);
    if (red && green && blue) {
      colors.push(rgbToHex({ r: Number(red[1]), g: Number(green[1]), b: Number(blue[1]) }));
    } else {
      // An entry with no components is "auto" — the reader's own default.
      colors.push(null);
    }
  }
  // `split` leaves a trailing empty entry after the final `;`; it is not a color.
  if (colors.length > 0 && body.trimEnd().endsWith(";")) colors.pop();
  return colors;
}

interface Reader {
  runs: RtfRun[];
  lines: RtfRun[][];
}

function pushText(reader: Reader, text: string, state: RtfState): void {
  if (text.length === 0) return;
  const last = reader.runs[reader.runs.length - 1];
  // Coalesce, so a `\'97` escape mid-word does not split the run around it.
  if (last && sameState(last.state, state)) last.text += text;
  else reader.runs.push({ text, state: { ...state } });
}

function sameState(a: RtfState, b: RtfState): boolean {
  return (
    a.color === b.color &&
    a.background === b.background &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough
  );
}

function breakLine(reader: Reader): void {
  reader.lines.push(reader.runs);
  reader.runs = [];
}

/** Walk the document, collecting styled runs and the colour table. */
function read(rtf: string): { lines: RtfRun[][]; colors: (string | null)[] } {
  const reader: Reader = { runs: [], lines: [] };
  let colors: (string | null)[] = [];

  const stack: RtfState[] = [];
  let state: RtfState = { ...INITIAL };
  let depth = 0;
  // Set when a group's contents are to be dropped rather than read.
  let skipUntil: number | null = null;
  let index = 0;

  while (index < rtf.length) {
    const char = rtf[index]!;

    if (char === "{") {
      stack.push({ ...state });
      depth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      if (skipUntil !== null && depth <= skipUntil) skipUntil = null;
      state = stack.pop() ?? { ...INITIAL };
      depth -= 1;
      index += 1;
      continue;
    }

    if (char === "\\") {
      const next = rtf[index + 1];

      // A backslash before a literal line break is a paragraph break, which is
      // how Cocoa writes its rows.
      if (next === "\n" || next === "\r") {
        if (skipUntil === null) breakLine(reader);
        index += 2;
        if (next === "\r" && rtf[index] === "\n") index += 1;
        continue;
      }

      // Escaped literals.
      if (next === "\\" || next === "{" || next === "}") {
        if (skipUntil === null) pushText(reader, next, state);
        index += 2;
        continue;
      }

      // `\*` marks a destination nobody is required to understand: skip it all.
      if (next === "*") {
        skipUntil ??= depth;
        index += 2;
        continue;
      }

      // `\'hh` — one byte in the document's codepage.
      if (next === "'") {
        const hex = rtf.slice(index + 2, index + 4);
        if (skipUntil === null && /^[0-9a-fA-F]{2}$/.test(hex)) {
          pushText(reader, fromCp1252(Number.parseInt(hex, 16)), state);
        }
        index += 4;
        continue;
      }

      const word = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(index));
      if (!word) {
        // A control symbol with no meaning here (`\~`, `\-`, …).
        index += 2;
        continue;
      }

      const keyword = word[1]!;
      const parameter = word[2] === undefined ? null : Number(word[2]);
      index += word[0].length;

      if (keyword === "colortbl") {
        const end = rtf.indexOf("}", index);
        colors = parseColorTable(rtf.slice(index, end === -1 ? undefined : end));
        skipUntil ??= depth;
        continue;
      }

      if (SKIPPED_DESTINATIONS.has(keyword)) {
        skipUntil ??= depth;
        continue;
      }

      if (skipUntil !== null) continue;

      switch (keyword) {
        case "par":
        case "line":
          breakLine(reader);
          break;
        case "tab":
          pushText(reader, "\t", state);
          break;
        case "cf":
          state.color = parameter ?? 0;
          break;
        // Terminals disagree on which of these carries the background.
        case "cb":
        case "chcbpat":
        case "highlight":
          state.background = parameter ?? 0;
          break;
        case "b":
          state.bold = parameter !== 0;
          break;
        case "i":
          state.italic = parameter !== 0;
          break;
        case "ul":
          state.underline = parameter !== 0;
          break;
        case "ulnone":
          state.underline = false;
          break;
        case "strike":
        case "striked":
          state.strikethrough = parameter !== 0;
          break;
        case "uc":
          state.unicodeSkip = parameter ?? 1;
          break;
        case "u": {
          if (parameter !== null) {
            // RTF writes values above 32767 as negative 16-bit integers.
            const code = parameter < 0 ? parameter + 65536 : parameter;
            pushText(reader, String.fromCodePoint(code), state);
          }
          // The fallback characters that follow are for readers without Unicode.
          let skipped = 0;
          while (skipped < state.unicodeSkip && index < rtf.length) {
            if (rtf[index] === "\\") {
              if (rtf[index + 1] === "'") index += 4;
              else index += 2;
            } else {
              index += 1;
            }
            skipped += 1;
          }
          break;
        }
        case "pard":
          // Paragraph defaults reset the paragraph, not the character run.
          break;
        default:
          break;
      }
      continue;
    }

    // Raw line breaks in the source are formatting and carry no content.
    if (char === "\n" || char === "\r") {
      index += 1;
      continue;
    }

    if (skipUntil === null) pushText(reader, char, state);
    index += 1;
  }

  if (reader.runs.length > 0) breakLine(reader);
  return { lines: reader.lines, colors };
}

/**
 * The colours standing in for "no colour at all".
 *
 * RTF has a way of saying it — colour index 0, "auto" — but a terminal painting
 * every cell from its own palette never uses it, and states the profile's own
 * foreground and background on every run instead. Taking those at face value
 * would put a colour on every character and a background behind all of it.
 *
 * So: if nothing in the document is auto, and one colour is behind more than
 * half of a multi-row paste, that colour is the profile's rather than something
 * the terminal chose to say. Both conditions earn their place — a short snippet
 * deliberately painted end to end in one colour means what it says, and a
 * document where the leader holds only a plurality is one where no colour is
 * standing in for "unstyled".
 */
function defaultIndices(lines: readonly RtfRun[][]): { color: number; background: number } {
  const colors = new Map<number, number>();
  const backgrounds = new Map<number, number>();
  let auto = false;
  let total = 0;

  for (const line of lines) {
    for (const run of line) {
      if (run.text.length === 0) continue;
      if (run.state.color === 0) auto = true;
      total += run.text.length;
      colors.set(run.state.color, (colors.get(run.state.color) ?? 0) + run.text.length);
      backgrounds.set(run.state.background, (backgrounds.get(run.state.background) ?? 0) + run.text.length);
    }
  }

  const commonest = (counts: Map<number, number>): [number, number] => {
    let best = 0;
    let bestCount = 0;
    for (const [value, count] of counts) {
      if (count > bestCount) [best, bestCount] = [value, count];
    }
    return [best, bestCount];
  };

  const [leader, leaderCount] = commonest(colors);
  // `colors.size > 1` because a document painted end to end in a single color
  // has nothing to be the default *of* — stripping it would leave nothing at all.
  const dominant = !auto && colors.size > 1 && lines.length > 1 && leaderCount * 2 > total;

  return {
    color: dominant ? leader : 0,
    // A background behind every single run is the profile's, whether or not the
    // foreground gave the game away.
    background: backgrounds.size === 1 ? commonest(backgrounds)[0] : 0,
  };
}

/**
 * Turn a terminal's `text/rtf` clipboard flavour into styled lines.
 *
 * Returns `null` when the markup carries no styling worth keeping, which is the
 * signal to fall back to plain text and the `$`-prompt heuristic — the same
 * contract `parseHtmlClipboard` keeps.
 */
export function parseRtfClipboard(rtf: string, ansi16: readonly string[]): ParsedLine[] | null {
  if (!rtf.trimStart().startsWith("{\\rtf")) return null;

  const { lines: rawLines, colors } = read(rtf);
  const defaults = defaultIndices(rawLines);

  const hex = (index: number): string | null => (index > 0 ? (colors[index] ?? null) : null);
  const named = (index: number, base: number): Color | null => {
    if (index === base) return null;
    const value = hex(index);
    // A color the palette cannot read leaves the run uncolored rather than
    // carrying something no escape code can say.
    return value ? nearestPaletteColor(value, ansi16) : null;
  };

  const lines: ParsedLine[] = rawLines.map((runs) => {
    const spans: ParsedSpan[] = runs.map((run) => {
      const fg = named(run.state.color, defaults.color);
      const bg = named(run.state.background, defaults.background);
      const marks: Marks = {
        ...(fg ? { fg } : {}),
        ...(bg ? { bg } : {}),
        ...(run.state.bold ? { bold: true as const } : {}),
        ...(run.state.italic ? { italic: true as const } : {}),
        ...(run.state.underline ? { underline: true as const } : {}),
        ...(run.state.strikethrough ? { strikethrough: true as const } : {}),
      };
      return { text: run.text, marks };
    });
    return { spans: spans.length > 0 ? spans : [{ text: "", marks: {} }] };
  });

  while (lines.length > 0 && lines[lines.length - 1]!.spans.every((span) => span.text.trim() === "")) {
    lines.pop();
  }
  if (lines.length === 0) return null;

  const styled = lines.some((line) => line.spans.some((span) => Object.keys(span.marks).length > 0));
  return styled ? lines : null;
}
