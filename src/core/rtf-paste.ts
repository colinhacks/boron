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
  /** The `\fN` in force, whose charset may override the document codepage. */
  font: number;
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
  font: -1,
};

/**
 * Destinations whose contents are metadata rather than text.
 *
 * Anything introduced by `\*` is skipped wholesale as the spec requires, which
 * covers `\*\expandedcolortbl` and friends. These are the ones that carry no
 * such marker and would otherwise spill their innards into the document.
 */
const SKIPPED_DESTINATIONS = new Set([
  "filetbl", "stylesheet", "listtable", "listoverridetable",
  "revtbl", "info", "pntext", "xmlnstbl",
]);

/**
 * `\fcharsetN` as a codepage, for the charsets that name one.
 *
 * A document can declare `\ansicpg1252` and still hold Japanese, by pointing the
 * run at a font whose charset says otherwise — which is exactly what Outlook
 * does. So the font wins where it has an opinion; 0 (ANSI) and 1 (default) have
 * none, and defer to the document.
 */
const FONT_CHARSETS = new Map<number, number>([
  [77, 10000], [128, 932], [129, 949], [134, 936], [136, 950], [161, 1253],
  [162, 1254], [163, 1258], [177, 1255], [178, 1256], [186, 1257], [204, 1251],
  [222, 874], [238, 1250],
]);

/**
 * `\ansicpgN` codepages, as labels `TextDecoder` knows.
 *
 * The platform already ships every decoder we could want, so `\'hh` bytes go
 * through it rather than through a table of our own. Codepages outside the
 * Encoding Standard — the DOS ones, mostly — have no decoder to reach for and
 * fall back to cp1252, which is what an RTF with no `\ansicpg` means anyway.
 */
const CODEPAGES = new Map<number, string>([
  // Deliberately no 1200 (UTF-16): `\'hh` is a *byte* escape, and a byte on its
  // own says nothing in a two-byte encoding. Word emits `\ansicpg1200` with
  // cp1252 byte escapes anyway and puts the real Unicode in `\u`, so falling
  // through to the default below is what actually reads those documents.
  [866, "ibm866"], [874, "windows-874"], [932, "shift_jis"], [936, "gbk"],
  [949, "euc-kr"], [950, "big5"], [1250, "windows-1250"],
  [1251, "windows-1251"], [1252, "windows-1252"], [1253, "windows-1253"],
  [1254, "windows-1254"], [1255, "windows-1255"], [1256, "windows-1256"],
  [1257, "windows-1257"], [1258, "windows-1258"], [10000, "macintosh"],
  [65001, "utf-8"],
]);

const decoders = new Map<number, TextDecoder>();

/**
 * Decode a run of `\'hh` bytes.
 *
 * A run rather than a byte at a time, because in Shift-JIS and the other
 * multi-byte codepages one character is spelled across several of them, and
 * decoding each alone turns the pair into two replacement characters.
 */
function decodeBytes(bytes: number[], codepage: number): string {
  let decoder = decoders.get(codepage);
  if (!decoder) {
    try {
      decoder = new TextDecoder(CODEPAGES.get(codepage) ?? "windows-1252");
    } catch {
      decoder = new TextDecoder("windows-1252");
    }
    decoders.set(codepage, decoder);
  }
  return decoder.decode(new Uint8Array(bytes));
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
  let codepage = 1252;
  // `\fonttbl` is read rather than skipped: its `\fcharset`s decide how a run's
  // `\'hh` bytes are decoded, whatever the document codepage says.
  const fontCharsets = new Map<number, number>();
  let fontTableDepth: number | null = null;
  let definingFont = -1;
  let depth = 0;
  // Set when a group's contents are to be dropped rather than read.
  let skipUntil: number | null = null;
  let index = 0;
  const suppressed = () => skipUntil !== null || fontTableDepth !== null;

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
      if (fontTableDepth !== null && depth <= fontTableDepth) fontTableDepth = null;
      state = stack.pop() ?? { ...INITIAL };
      depth -= 1;
      index += 1;
      // The root group has closed. Whatever follows is trailing rubbish — a
      // stray NUL, a newline — and not part of the document.
      if (depth === 0) break;
      continue;
    }

    if (char === "\\") {
      const next = rtf[index + 1];

      // A backslash before a literal line break is a paragraph break, which is
      // how Cocoa writes its rows.
      if (next === "\n" || next === "\r") {
        if (!suppressed()) breakLine(reader);
        index += 2;
        if (next === "\r" && rtf[index] === "\n") index += 1;
        continue;
      }

      // Escaped literals.
      if (next === "\\" || next === "{" || next === "}") {
        if (!suppressed()) pushText(reader, next, state);
        index += 2;
        continue;
      }

      // `\*` marks a destination nobody is required to understand: skip it all.
      if (next === "*") {
        skipUntil ??= depth;
        index += 2;
        continue;
      }

      // `\'hh` — bytes in the document's codepage, taken as a run so that a
      // multi-byte character does not get decoded a half at a time.
      if (next === "'") {
        const bytes: number[] = [];
        while (rtf[index] === "\\" && rtf[index + 1] === "'") {
          const hex = rtf.slice(index + 2, index + 4);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
            // Truncated at the end of the document, or simply malformed. Step
            // over the escape itself and no further — the two characters after
            // it are whatever they are, not ours to swallow.
            index += 2;
            break;
          }
          bytes.push(Number.parseInt(hex, 16));
          index += 4;
        }
        if (!suppressed() && bytes.length > 0) {
          const charset = fontCharsets.get(state.font);
          const encoding = (charset !== undefined && FONT_CHARSETS.get(charset)) || codepage;
          pushText(reader, decodeBytes(bytes, encoding), state);
        }
        continue;
      }

      // The control symbols worth spelling out. The rest carry no text.
      if (next === "~" || next === "_") {
        // A non-breaking space and a non-breaking hyphen; both are just
        // characters once they are in a terminal block.
        if (!suppressed()) pushText(reader, next === "~" ? " " : "-", state);
        index += 2;
        continue;
      }

      const word = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(index));
      if (!word) {
        // An optional hyphen, a formula character, something we do not know:
        // none of them contribute text.
        index += 2;
        continue;
      }

      const keyword = word[1]!;
      const parameter = word[2] === undefined ? null : Number(word[2]);
      index += word[0].length;

      // `\binN` is followed by N bytes of raw binary. They are data, not
      // markup, and scanning them for control words finds nonsense.
      if (keyword === "bin") {
        if (parameter !== null && parameter > 0) index += parameter;
        continue;
      }

      // The codepage is declared in the header, before any text, so reading it
      // here is early enough for every `\'hh` that follows.
      if (keyword === "ansicpg") {
        if (parameter !== null) codepage = parameter;
        continue;
      }

      if (keyword === "fonttbl") {
        fontTableDepth ??= depth;
        continue;
      }

      if (keyword === "f") {
        if (fontTableDepth !== null) definingFont = parameter ?? -1;
        else state.font = parameter ?? -1;
        continue;
      }

      if (keyword === "fcharset") {
        if (fontTableDepth !== null && definingFont >= 0 && parameter !== null) {
          fontCharsets.set(definingFont, parameter);
        }
        continue;
      }

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

      if (suppressed()) continue;

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
        case "plain":
          // Resets character formatting to the document default, colors
          // included. `@iarna/rtf-parser` leaves the color alone here, but the
          // spec lists it among the character properties and `\cf0` is exactly
          // what "no color" already means to us.
          state.bold = false;
          state.italic = false;
          state.underline = false;
          state.strikethrough = false;
          state.color = 0;
          state.background = 0;
          break;
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

    if (!suppressed()) pushText(reader, char, state);
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
