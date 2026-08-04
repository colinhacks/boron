import type { BaseEditor, BaseRange } from "slate";
import type { HistoryEditor } from "slate-history";
import type { ReactEditor } from "slate-react";
import type { LineElement, StyledText } from "../core/document.ts";
import type { SpanRole } from "../core/types.ts";

export type BoronEditor = BaseEditor & ReactEditor & HistoryEditor;

/** The decoration the `$`-prompt pass attaches to a range. */
export interface RoleRange extends BaseRange {
  boronRole?: SpanRole;
}

declare module "slate" {
  interface CustomTypes {
    Editor: BoronEditor;
    Element: LineElement;
    Text: StyledText;
    Range: RoleRange;
  }
}
