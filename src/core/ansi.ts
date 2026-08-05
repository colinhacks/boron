import { colorFromAnsi256, rgbToHex } from "./palette.ts";
import { marksEqual, NAMED_COLORS, type Color, type Marks } from "./types.ts";

const ESC = "\u001b";
const BEL = "\u0007";

/** Full, non-optional style state — the parser's working register. */
interface SgrState {
  fg: Color | null;
  bg: Color | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  hidden: boolean;
}

function initialState(): SgrState {
  return {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    hidden: false,
  };
}

function resetState(state: SgrState): void {
  Object.assign(state, initialState());
}

function stateToMarks(state: SgrState): Marks {
  return {
    ...(state.fg !== null ? { fg: state.fg } : {}),
    ...(state.bg !== null ? { bg: state.bg } : {}),
    ...(state.bold ? { bold: true as const } : {}),
    ...(state.dim ? { dim: true as const } : {}),
    ...(state.italic ? { italic: true as const } : {}),
    ...(state.underline ? { underline: true as const } : {}),
    ...(state.strikethrough ? { strikethrough: true as const } : {}),
    ...(state.inverse ? { inverse: true as const } : {}),
    ...(state.hidden ? { hidden: true as const } : {}),
  };
}

/** `[38, 2, r, g, b]` / `[38, 5, n]`, optionally with a colorspace slot. */
function colorFromSubParams(group: readonly number[]): Color | null {
  const mode = group[1];
  if (mode === 5) {
    const index = group[2];
    return index === undefined || Number.isNaN(index) ? null : colorFromAnsi256(index);
  }
  if (mode === 2) {
    // T.416 allows an ignorable colorspace id at group[2], so take the last three.
    const tail = group.slice(-3);
    const [r, g, b] = tail;
    if (r === undefined || g === undefined || b === undefined) return null;
    if ([r, g, b].some(Number.isNaN)) return null;
    return rgbToHex({ r, g, b });
  }
  return null;
}

function applySimpleCode(state: SgrState, code: number): void {
  switch (code) {
    case 0:
      resetState(state);
      return;
    case 1:
      state.bold = true;
      return;
    case 2:
      state.dim = true;
      return;
    case 3:
      state.italic = true;
      return;
    case 4:
      state.underline = true;
      return;
    case 7:
      state.inverse = true;
      return;
    case 8:
      state.hidden = true;
      return;
    case 9:
      state.strikethrough = true;
      return;
    // ECMA-48 calls 21 "doubly underlined", but the emitters that still reach
    // for it overwhelmingly mean "bold off" — and a missing double underline
    // degrades far better than a spurious one.
    case 21:
      state.bold = false;
      return;
    case 22:
      state.bold = false;
      state.dim = false;
      return;
    case 23:
      state.italic = false;
      return;
    case 24:
      state.underline = false;
      return;
    case 27:
      state.inverse = false;
      return;
    case 28:
      state.hidden = false;
      return;
    case 29:
      state.strikethrough = false;
      return;
    case 39:
      state.fg = null;
      return;
    case 49:
      state.bg = null;
      return;
    default:
      break;
  }
  if (code >= 30 && code <= 37) state.fg = NAMED_COLORS[code - 30]!;
  else if (code >= 40 && code <= 47) state.bg = NAMED_COLORS[code - 40]!;
  else if (code >= 90 && code <= 97) state.fg = NAMED_COLORS[code - 90 + 8]!;
  else if (code >= 100 && code <= 107) state.bg = NAMED_COLORS[code - 100 + 8]!;
}

function applySgr(state: SgrState, raw: string): void {
  if (raw === "") {
    resetState(state);
    return;
  }
  const groups = raw
    .split(";")
    .map((group) => group.split(":").map((value) => (value === "" ? 0 : Number.parseInt(value, 10))));

  let i = 0;
  while (i < groups.length) {
    const group = groups[i]!;
    const code = group[0] ?? 0;

    if ((code === 38 || code === 48) && group.length > 1) {
      const color = colorFromSubParams(group);
      if (color !== null) {
        if (code === 38) state.fg = color;
        else state.bg = color;
      }
      i += 1;
      continue;
    }

    if (code === 38 || code === 48) {
      const mode = groups[i + 1]?.[0];
      if (mode === 5) {
        const index = groups[i + 2]?.[0];
        const color = index === undefined || Number.isNaN(index) ? null : colorFromAnsi256(index);
        if (color !== null) {
          if (code === 38) state.fg = color;
          else state.bg = color;
        }
        i += 3;
        continue;
      }
      if (mode === 2) {
        const r = groups[i + 2]?.[0] ?? 0;
        const g = groups[i + 3]?.[0] ?? 0;
        const b = groups[i + 4]?.[0] ?? 0;
        const color = rgbToHex({ r, g, b });
        if (code === 38) state.fg = color;
        else state.bg = color;
        i += 5;
        continue;
      }
      i += 1;
      continue;
    }

    applySimpleCode(state, code);
    i += 1;
  }
}

interface Cell {
  ch: string;
  state: SgrState;
}

export interface ParsedSpan {
  text: string;
  marks: Marks;
}

export interface ParsedLine {
  spans: ParsedSpan[];
}

const TAB_WIDTH = 8;

/** A trailing run of plain spaces carries no information; a colored one does. */
function isTrimmableCell(cell: Cell): boolean {
  return cell.ch === " " && cell.state.bg === null && !cell.state.underline && !cell.state.inverse;
}

function coalesce(cells: readonly Cell[], trimTrailing: boolean): ParsedLine {
  let end = cells.length;
  if (trimTrailing) {
    while (end > 0 && isTrimmableCell(cells[end - 1]!)) end -= 1;
  }

  const spans: ParsedSpan[] = [];
  const marksCache = new Map<SgrState, Marks>();
  const marksFor = (state: SgrState): Marks => {
    let marks = marksCache.get(state);
    if (!marks) {
      marks = stateToMarks(state);
      marksCache.set(state, marks);
    }
    return marks;
  };

  for (let i = 0; i < end; i++) {
    const cell = cells[i]!;
    const marks = marksFor(cell.state);
    const last = spans[spans.length - 1];
    if (last && marksEqual(last.marks, marks)) last.text += cell.ch;
    else spans.push({ text: cell.ch, marks });
  }

  if (spans.length === 0) spans.push({ text: "", marks: {} });
  return { spans };
}

export interface ParseOptions {
  /**
   * Drop trailing runs of plain spaces, which is what a paste wants — a terminal
   * pads its rows out to the window and none of it is content.
   *
   * A share link wants the opposite. Trailing spaces feed `layout.widest`, so
   * dropping them narrows the block, and a format that quietly changes the
   * picture is not a format you can freeze. Defaults to trimming.
   */
  trimTrailing?: boolean;
}

/**
 * Parse terminal output — ANSI escapes and all — into styled lines.
 *
 * Text is laid into a per-line cell buffer with a cursor rather than appended,
 * so carriage returns, backspaces and erase-line sequences behave the way they
 * do in a real terminal. That is what makes a pasted progress bar or spinner
 * collapse to its final frame instead of smearing across the line.
 */
export function parseAnsi(input: string, options: ParseOptions = {}): ParsedLine[] {
  const trimTrailing = options.trimTrailing ?? true;
  const lines: ParsedLine[] = [];
  let cells: Cell[] = [];
  let col = 0;

  const state = initialState();
  let snapshot: SgrState = { ...state };
  const commit = () => {
    snapshot = { ...state };
  };

  const write = (ch: string) => {
    while (cells.length < col) cells.push({ ch: " ", state: snapshot });
    cells[col] = { ch, state: snapshot };
    col += 1;
  };

  const endLine = () => {
    lines.push(coalesce(cells, trimTrailing));
    cells = [];
    col = 0;
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;

    if (ch === ESC) {
      const next = input[i + 1];

      if (next === "[") {
        let j = i + 2;
        while (j < input.length && /[<=>?]/.test(input[j]!)) j += 1;
        const paramStart = j;
        while (j < input.length && /[0-9;:]/.test(input[j]!)) j += 1;
        const params = input.slice(paramStart, j);
        while (j < input.length && input.charCodeAt(j) >= 0x20 && input.charCodeAt(j) <= 0x2f) j += 1;
        const final = input[j];
        if (final === undefined) break; // truncated escape at end of input

        if (final === "m") {
          applySgr(state, params);
          commit();
        } else if (final === "K") {
          const mode = Number.parseInt(params.split(";")[0] || "0", 10) || 0;
          if (mode === 0) cells.length = Math.min(cells.length, col);
          else if (mode === 1) {
            for (let k = 0; k <= col && k < cells.length; k++) cells[k] = { ch: " ", state: snapshot };
          } else cells.length = 0;
        }
        i = j + 1;
        continue;
      }

      if (next === "]" || next === "P" || next === "X" || next === "^" || next === "_") {
        // A string-terminated sequence (OSC 8 hyperlinks, window titles, DCS).
        // Drop the control envelope; any visible text follows it separately.
        let j = i + 2;
        while (j < input.length) {
          if (input[j] === BEL) {
            j += 1;
            break;
          }
          if (input[j] === ESC && input[j + 1] === "\\") {
            j += 2;
            break;
          }
          j += 1;
        }
        i = j;
        continue;
      }

      i += 2;
      continue;
    }

    if (ch === "\n") {
      endLine();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (input[i + 1] === "\n") {
        endLine();
        i += 2;
      } else {
        col = 0;
        i += 1;
      }
      continue;
    }
    if (ch === "\t") {
      const stop = Math.floor(col / TAB_WIDTH) * TAB_WIDTH + TAB_WIDTH;
      while (col < stop) write(" ");
      i += 1;
      continue;
    }
    if (ch === "\b") {
      col = Math.max(0, col - 1);
      i += 1;
      continue;
    }
    if (ch < " " && ch !== " ") {
      i += 1; // drop remaining C0 controls
      continue;
    }

    // Keep surrogate pairs (emoji, box-drawing supplements) in one cell.
    const code = input.codePointAt(i)!;
    const size = code > 0xffff ? 2 : 1;
    write(input.slice(i, i + size));
    i += size;
  }

  endLine();
  return lines;
}

const SGR_RE = /\u001b\[[0-9;:?]*m/;

/**
 * Whether a plain-text paste carries color information of its own. When it does
 * not, the `$`-prompt heuristic takes over.
 */
export function hasAnsi(input: string): boolean {
  return SGR_RE.test(input);
}

/** All escape sequences removed, leaving readable text. */
export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .map((line) => line.spans.map((span) => span.text).join(""))
    .join("\n");
}
