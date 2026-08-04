import { Text, type Editor, type NodeEntry } from "slate";
import { lineText, type LineElement } from "../core/document.ts";
import { classifyDocument, hasCommands, type LineClassification } from "../core/prompt.ts";
import type { SpanRole } from "../core/types.ts";
import type { RoleRange } from "./custom-types.ts";

interface Snapshot {
  children: unknown;
  classifications: LineClassification[];
  commandsPresent: boolean;
  /** Character offset of each text child within its line. */
  offsets: number[][];
}

/**
 * The `$`-prompt styling, expressed as decorations rather than stored marks —
 * so it recomputes live as you type and never fights an explicit color.
 *
 * Classification is whole-document (a trailing `\` continues a command, and a
 * document with no commands at all should not dim everything), so the result is
 * cached against `editor.children` and reused across the per-node calls Slate
 * makes during a single render.
 */
export function createDecorator(editor: Editor): (entry: NodeEntry) => RoleRange[] {
  let snapshot: Snapshot | null = null;

  const refresh = (): Snapshot => {
    if (snapshot && snapshot.children === editor.children) return snapshot;
    const lines = editor.children as LineElement[];
    const classifications = classifyDocument(lines.map(lineText));
    const offsets = lines.map((line) => {
      const result: number[] = [];
      let offset = 0;
      for (const child of line.children) {
        result.push(offset);
        offset += child.text.length;
      }
      return result;
    });
    snapshot = {
      children: editor.children,
      classifications,
      commandsPresent: hasCommands(classifications),
      offsets,
    };
    return snapshot;
  };

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

    if (classification.kind !== "command") {
      return [range(0, length, commandsPresent ? "output" : "plain")];
    }

    const boundary = classification.commandStart - start;
    if (boundary <= 0) return [range(0, length, "command")];
    if (boundary >= length) return [range(0, length, "prompt")];
    return [range(0, boundary, "prompt"), range(boundary, length, "command")];
  };
}
