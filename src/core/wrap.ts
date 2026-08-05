import type { RenderLine, RenderSpan } from "./types.ts";

/**
 * Break long lines onto continuation rows, the way a terminal does.
 *
 * A terminal is a fixed number of columns wide and puts the character that
 * doesn't fit on the next row — no word awareness, no hyphenation, no measuring
 * of anything. That is what this reproduces: rows are cut at an exact character
 * count, mid-word and mid-span if that is where the boundary lands.
 *
 * Character-counted rather than measured on purpose. The three renderers — the
 * preview, the canvas and the SVG — have to break in the same places or the
 * picture on screen stops being the picture you save, and agreeing on a count is
 * something a `contenteditable` can do too. The preview holds up its end with
 * `white-space: break-spaces` on a box exactly this many characters wide, which
 * is the one white-space value that makes the browser spend a cell on a space at
 * the boundary instead of hanging it past the edge.
 *
 * The wrap is visual only. The document keeps its logical lines, so `toAnsi` and
 * friends still emit what was pasted and the receiving terminal wraps it to its
 * own width — a line break invented here is not one a terminal was ever told
 * about.
 */
export function wrapRenderLines(lines: readonly RenderLine[], columns: number): RenderLine[] {
  const width = Math.max(1, Math.floor(columns));
  const rows: RenderLine[] = [];

  for (const line of lines) {
    // `length` counts UTF-16 units, so this is conservative in exactly the safe
    // direction: a line it lets through is short enough however it is counted.
    const total = line.spans.reduce((sum, span) => sum + span.text.length, 0);
    if (total <= width) {
      rows.push(line);
      continue;
    }

    let row: RenderSpan[] = [];
    let used = 0;

    for (const span of line.spans) {
      // Code points, so a surrogate pair is never cut in half — `parseAnsi`
      // already treats one as a single cell.
      let rest = [...span.text];
      if (rest.length === 0) {
        if (row.length === 0) row.push(span);
        continue;
      }
      while (rest.length > 0) {
        // Flushed on the way in rather than on the way out, so a line ending
        // exactly on the boundary is one row and not one row plus an empty one.
        if (used === width) {
          rows.push({ spans: row });
          row = [];
          used = 0;
        }
        const take = rest.slice(0, width - used);
        row.push({ ...span, text: take.join("") });
        used += take.length;
        rest = rest.slice(take.length);
      }
    }

    rows.push({ spans: row.length > 0 ? row : [{ text: "", marks: {}, role: "plain" }] });
  }

  return rows;
}
