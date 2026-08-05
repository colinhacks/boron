import { parseAnsi } from "./core/ansi.ts";
import { parsedLinesToDocument, sanitizeDocument, type LineElement } from "./core/document.ts";
import { toAnsi } from "./core/serialize.ts";
import type { RenderLine } from "./core/types.ts";
import { DEFAULT_FRAME } from "./export/layout.ts";
import { sanitizeBackgroundId, sanitizeFrame, sanitizeThemeId, type Workspace } from "./workspace.ts";

/**
 * The shareable description of a workspace — the format, not the model.
 *
 * # This file is a promise, and the rest of the app is not
 *
 * A URL is public and permanent. Every link anyone sends is a compatibility
 * constraint that never expires, cannot be migrated, and is held by people who
 * will never read a changelog. So the thing that goes in one cannot be whatever
 * shape the editor happens to use this month.
 *
 * The first attempt put `TerminalDocument` and `FrameSettings` in the payload
 * directly, which made the Slate schema and the sidebar's settings object a
 * published API with no seam to translate at. This module *is* that seam. Nothing
 * below refers to a Slate type, a `FrameSettings`, or anything else that can move:
 * the wire types are made of strings, numbers and booleans, and `toWire`/`fromWire`
 * are the only places the two vocabularies meet. Swap the editor and this file
 * keeps its promise; the mapping underneath it changes and nothing else does.
 *
 * # Why the content is ANSI
 *
 * Because it is the one part of this that Boron did not invent. Lines of styled
 * runs, seven modifiers that are each exactly one SGR code, colors as a name, a
 * 256-index or truecolor — that is ECMA-48, and it cannot drift without terminals
 * drifting. It is also the project's own claim about itself, now enforced rather
 * than hoped for, so a format built on it is a format that cannot outlive its
 * meaning. It has the pleasant side effect of being writable by hand: a script
 * that has terminal output already has the content field.
 *
 * # Rules for changing this file
 *
 * Don't, for version 1. Add `WireWorkspaceV2` beside it and a branch in
 * `fromWire`; leave the v1 reader exactly as it is, forever. The frozen corpus in
 * `wire.test.ts` holds real payloads and will tell you the moment you break one —
 * that is the mechanism, not care.
 */
export interface WireWorkspaceV1 {
  version: 1;
  /** The document as terminal output, escape sequences and all. */
  content: string;
  /** Theme id. An unknown one falls back to the default rather than failing. */
  theme?: string;
  /** Backdrop id, or `"none"` for a transparent frame. */
  backdrop?: string;
  frame?: WireFrameV1;
}

/**
 * Deliberately not `FrameSettings`. The names here are the ones being frozen, and
 * they describe what a reader sees rather than how this app happens to compute
 * it — `columns`, because a width in columns is a terminal idea, while whatever
 * this app does with it is ours to change. It has already changed once: the
 * field was written when columns were only a floor under a block that never
 * wrapped, and it survived the move to a real width unedited, which is the whole
 * argument for naming a wire field after the reader's idea of it.
 */
export interface WireFrameV1 {
  /** Space between the block and the edge of the image, in px. */
  padding?: number;
  /** Corner radius, in px. */
  radius?: number;
  /** Whether the window title bar is drawn. */
  titleBar?: boolean;
  title?: string;
  /** Shadow strength, 0-100. */
  shadow?: number;
  /** How many columns wide the terminal is. Longer lines wrap to it. */
  columns?: number;
}

/**
 * The document as raw terminal output.
 *
 * Every run is tagged `plain` rather than run through the `$`-prompt heuristic,
 * because the heuristic is a *rendering* decision that recomputes from the text.
 * Baking it in would freeze one reading of the document: edit the first line so
 * it is no longer a command and the lines below it would stay dimmed, carrying
 * explicit marks nobody asked for.
 */
function documentToAnsi(document: readonly LineElement[]): string {
  const lines: RenderLine[] = document.map((line) => ({
    spans: line.children.map(({ text, ...marks }) => ({ text, marks, role: "plain" as const })),
  }));
  return toAnsi(lines);
}

export function toWire(workspace: Workspace): WireWorkspaceV1 {
  return {
    version: 1,
    content: documentToAnsi(workspace.document),
    theme: workspace.themeId,
    backdrop: workspace.backgroundId,
    // Written out in full, never diffed against the defaults: a link is a promise
    // about an image, and one that repaints because a default moved has broken it.
    frame: {
      padding: workspace.frame.framePadding,
      radius: workspace.frame.radius,
      titleBar: workspace.frame.showChrome,
      title: workspace.frame.title,
      shadow: workspace.frame.shadowStrength,
      columns: workspace.frame.columns,
    },
  };
}

/**
 * A workspace from an untrusted payload, or `null` if it is not one.
 *
 * Every field is decided here, so a payload naming only the content still renders
 * the same way for everyone who opens it — the reader's own settings never leak
 * in. Values go through the same sanitizers a stored workspace does, so nothing
 * arrives that the exporters could not write an escape code for.
 */
export function fromWire(input: unknown): Workspace | null {
  if (typeof input !== "object" || input === null) return null;
  const wire = input as Partial<WireWorkspaceV1>;
  // A v2 adds a branch here. It never edits the v1 path.
  if (wire.version !== 1) return null;
  if (typeof wire.content !== "string") return null;

  // Trailing spaces are content to a share link even though they are noise to a
  // paste: they take up cells, so trimming them moves where a long line wraps
  // and unpaints any that carried a background.
  const document = sanitizeDocument(
    parsedLinesToDocument(parseAnsi(wire.content, { trimTrailing: false })),
  );
  if (document === null) return null;

  const frame = (typeof wire.frame === "object" && wire.frame !== null ? wire.frame : {}) as WireFrameV1;
  return {
    document,
    themeId: sanitizeThemeId(wire.theme),
    backgroundId: sanitizeBackgroundId(wire.backdrop),
    frame: sanitizeFrame({
      framePadding: frame.padding ?? DEFAULT_FRAME.framePadding,
      radius: frame.radius ?? DEFAULT_FRAME.radius,
      showChrome: frame.titleBar ?? DEFAULT_FRAME.showChrome,
      title: frame.title ?? DEFAULT_FRAME.title,
      shadowStrength: frame.shadow ?? DEFAULT_FRAME.shadowStrength,
      columns: frame.columns ?? DEFAULT_FRAME.columns,
    }),
  };
}
