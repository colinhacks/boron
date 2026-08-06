import { Text, type Editor, type NodeEntry } from "slate";
import { lineText, type LineElement } from "../core/document.ts";
import { classifyDocument, hasCommands, type LineClassification } from "../core/prompt.ts";
import type { SpanRole } from "../core/types.ts";
import type { BoxSpan } from "./box.ts";
import type { RoleRange } from "./custom-types.ts";

interface Snapshot {
  classifications: LineClassification[];
  commandsPresent: boolean;
  /** Character offset of each text child within its line. */
  offsets: number[][];
}

/**
 * Classification, cached against the document it describes.
 *
 * Keyed on `editor.children` — Slate replaces that array on every content
 * change and never mutates it, so identity is exactly "same document". A
 * WeakMap rather than a variable inside the decorator because the decorator is
 * rebuilt whenever the box moves (see below) and the classification has not
 * changed just because the selection has; letting the cache outlive the closure
 * is what keeps a drag from re-classifying the whole document per mouse move.
 */
const snapshots = new WeakMap<object, Snapshot>();

function snapshotOf(editor: Editor): Snapshot {
  const children = editor.children as LineElement[];
  const cached = snapshots.get(children);
  if (cached) return cached;

  const classifications = classifyDocument(children.map(lineText));
  const offsets = children.map((line) => {
    const result: number[] = [];
    let offset = 0;
    for (const child of line.children) {
      result.push(offset);
      offset += child.text.length;
    }
    return result;
  });
  const snapshot: Snapshot = {
    classifications,
    commandsPresent: hasCommands(classifications),
    offsets,
  };
  snapshots.set(children, snapshot);
  return snapshot;
}

/**
 * The `$`-prompt styling, expressed as decorations rather than stored marks —
 * so it recomputes live as you type and never fights an explicit color.
 *
 * The box highlight rides along here too. It has to be a decoration rather than
 * a real selection because there is only one of those and it runs in a line,
 * and decorations are already the mechanism for "paint this range without
 * storing anything on it".
 *
 * `spans` is taken by value, and the caller must build a new decorator whenever
 * it changes. That is not a style preference: slate-react re-runs the
 * decorators only when the `decorate` *prop identity* changes — it holds the
 * function in a ref and notifies the text components from a layout effect keyed
 * on that identity — so a decorator that reads mutable state behind a stable
 * identity silently never repaints.
 */
export function createDecorator(
  editor: Editor,
  spans: readonly BoxSpan[],
): (entry: NodeEntry) => RoleRange[] {
  const refresh = () => snapshotOf(editor);

  return ([node, path]: NodeEntry): RoleRange[] => {
    if (!Text.isText(node) || path.length !== 2) return [];
    const length = node.text.length;
    if (length === 0) return [];

    const { classifications, commandsPresent, offsets } = refresh();
    const lineIndex = path[0]!;
    const childIndex = path[1]!;
    const classification = classifications[lineIndex];
    if (!classification) return [];

    const start = offsets[lineIndex]?.[childIndex] ?? 0;
    const range = (from: number, to: number, boronRole: SpanRole): RoleRange => ({
      anchor: { path, offset: from },
      focus: { path, offset: to },
      boronRole,
    });

    const roles: RoleRange[] =
      classification.kind !== "command"
        ? [range(0, length, commandsPresent ? "output" : "plain")]
        : (() => {
            const boundary = classification.commandStart - start;
            if (boundary <= 0) return [range(0, length, "command")];
            if (boundary >= length) return [range(0, length, "prompt")];
            return [range(0, boundary, "prompt"), range(boundary, length, "command")];
          })();

    // The box's spans are offsets into the whole line; this node holds
    // `[start, start + length)` of it. Slate splits a leaf wherever decorations
    // start and stop and merges the props of every one covering it, so the
    // highlight and the role can be returned independently and still land on the
    // same characters.
    for (const span of spans) {
      if (span.line !== lineIndex) continue;
      const from = Math.max(span.start - start, 0);
      const to = Math.min(span.end - start, length);
      if (from >= to) continue;
      roles.push({ anchor: { path, offset: from }, focus: { path, offset: to }, boronBox: true });
    }

    return roles;
  };
}
