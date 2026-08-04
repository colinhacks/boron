import type { ParsedLine } from "./ansi.ts";
import { classifyDocument, hasCommands } from "./prompt.ts";
import type { Marks, RenderLine, RenderSpan, SpanRole } from "./types.ts";

export type StyledText = Marks & { text: string };

export interface LineElement {
  type: "line";
  children: StyledText[];
}

export type TerminalDocument = LineElement[];

export function lineText(line: LineElement): string {
  return line.children.map((child) => child.text).join("");
}

export function emptyDocument(): TerminalDocument {
  return [{ type: "line", children: [{ text: "" }] }];
}

/**
 * Flatten the Slate document into styled runs tagged with their `$`-prompt
 * role. Runs are split at the prompt boundary so a single leaf spanning
 * `$ npm install` yields a dim `$ ` and a bright `npm install`.
 */
export function documentToRenderLines(doc: readonly LineElement[]): RenderLine[] {
  const classifications = classifyDocument(doc.map(lineText));
  const commandsPresent = hasCommands(classifications);

  return doc.map((line, index) => {
    const classification = classifications[index]!;
    const roleAt = (offset: number): SpanRole => {
      if (classification.kind === "command") {
        return offset < classification.commandStart ? "prompt" : "command";
      }
      return commandsPresent ? "output" : "plain";
    };

    const spans: RenderSpan[] = [];
    let offset = 0;

    for (const child of line.children) {
      const { text, ...marks } = child;
      if (text.length === 0) {
        spans.push({ text: "", marks, role: roleAt(offset) });
        continue;
      }
      let start = 0;
      while (start < text.length) {
        const role = roleAt(offset + start);
        const boundary = classification.commandStart - offset;
        const end = role === "prompt" && boundary < text.length ? boundary : text.length;
        spans.push({ text: text.slice(start, end), marks, role });
        start = end;
      }
      offset += text.length;
    }

    if (spans.length === 0) spans.push({ text: "", marks: {}, role: roleAt(0) });
    return { spans };
  });
}

/** Build a Slate document from parsed terminal lines. */
export function parsedLinesToDocument(lines: readonly ParsedLine[]): TerminalDocument {
  const doc = lines.map((line): LineElement => {
    const children = line.spans
      .filter((span, index) => span.text.length > 0 || index === 0)
      .map((span): StyledText => ({ text: span.text, ...span.marks }));
    return { type: "line", children: children.length > 0 ? children : [{ text: "" }] };
  });
  return doc.length > 0 ? doc : emptyDocument();
}
