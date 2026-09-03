import { parseAnsi } from "./core/ansi.ts";
import { parsedLinesToDocument, sanitizeDocument, type LineElement } from "./core/document.ts";
import { toAnsi } from "./core/serialize.ts";
import type { RenderLine } from "./core/types.ts";
import {
  sanitizeBackgroundId,
  sanitizeFrame,
  sanitizeHighlight,
  sanitizeThemeId,
  type Workspace,
} from "./workspace.ts";

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
  /**
   * Backdrop id, `"none"` for a transparent frame, or a `#rrggbb` colour for a
   * flat fill. A colour is a *value* in a field that already held strings, so
   * this is not a v2: every link written before it still reads exactly the same,
   * and a build that predates it treats a fill the way it treats any id it does
   * not know — as the default backdrop.
   */
  backdrop?: string;
  /**
   * What the syntax control reads — `auto`, `ansi`, or a language id.
   *
   * A new optional field rather than a v2, the same shape as `theme` above: a
   * link written before it simply lacks it, and an absent one means `auto`. It
   * has to travel even though it paints no pixels, because the address bar now
   * carries your *own* workspace — so a reload goes through here, and a reader
   * whose refresh silently disarmed auto-detection would have no way to tell.
   */
  syntax?: string;
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
  /**
   * The canvas the image is pinned to — `og`, `square`, `wide` — or absent for
   * one sized to its content.
   *
   * A name rather than a width and a height, for the same reason `columns` is a
   * count: 1200×630 is this app's reading of "an Open Graph card" today, and a
   * link that spelled the pixels out would keep pointing at those two numbers
   * after the platforms moved. An unknown name reads back as no aspect at all.
   */
  aspect?: string;
}

/**
 * What a v1 link means when it does not say — frozen, and never read from the
 * app's own defaults again.
 *
 * These numbers duplicate `DEFAULT_FRAME` today, and that duplication is the
 * feature. `DEFAULT_FRAME` is a *product* decision and is free to move: a wider
 * block, a softer shadow, a card-shaped canvas out of the box. But a link that
 * left a field out was written against the numbers below, and reading the app's
 * defaults would repaint every one of those links the day one of them moved —
 * which is exactly the failure this file was written to prevent, arriving
 * through the one door left open.
 *
 * `aspect` is where it was already live rather than hypothetical. Every link the
 * app writes says `aspect=` for a free-sized image, which reads back as *unsaid*
 * — so the moment `DEFAULT_FRAME.aspect` became a preset, every link ever sent
 * would have turned into that card. `null` here is now a fact about v1 rather
 * than a value borrowed from somewhere it can change.
 *
 * A v2 gets its own block beside this one. This one never changes.
 */
const V1_DEFAULTS = {
  /**
   * Theme and backdrop are ids rather than values, so this freezes *which name*
   * an unsaid link gets, not what that name paints. A palette is a design the
   * app owns; see wiki/share-links.md on why backdrop ids already moved once.
   */
  theme: "boron",
  backdrop: "midnight",
  padding: 48,
  radius: 12,
  titleBar: true,
  title: "",
  shadow: 100,
  columns: 80,
  aspect: null,
  /**
   * `auto` is a frozen concept rather than a movable default — it names the
   * absence of an answer — so this one could not drift. It is written here
   * anyway, because a reader should not have to check nine fields against this
   * block and then work out on their own why the tenth is somewhere else.
   */
  syntax: "auto",
} as const;

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
    syntax: workspace.highlight,
    // Written out in full, never diffed against the defaults: a link is a promise
    // about an image, and one that repaints because a default moved has broken it.
    frame: {
      padding: workspace.frame.framePadding,
      radius: workspace.frame.radius,
      titleBar: workspace.frame.showChrome,
      title: workspace.frame.title,
      shadow: workspace.frame.shadowStrength,
      columns: workspace.frame.columns,
      // The one field written only when set. Every other one is spelled out so a
      // moved default cannot repaint a link, but there is no default to move
      // here — absent and "no aspect" are the same statement.
      ...(workspace.frame.aspect === null ? {} : { aspect: workspace.frame.aspect }),
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
    highlight: sanitizeHighlight(wire.syntax ?? V1_DEFAULTS.syntax),
    themeId: sanitizeThemeId(wire.theme ?? V1_DEFAULTS.theme),
    backgroundId: sanitizeBackgroundId(wire.backdrop ?? V1_DEFAULTS.backdrop),
    frame: sanitizeFrame({
      framePadding: frame.padding ?? V1_DEFAULTS.padding,
      radius: frame.radius ?? V1_DEFAULTS.radius,
      showChrome: frame.titleBar ?? V1_DEFAULTS.titleBar,
      title: frame.title ?? V1_DEFAULTS.title,
      shadowStrength: frame.shadow ?? V1_DEFAULTS.shadow,
      columns: frame.columns ?? V1_DEFAULTS.columns,
      aspect: frame.aspect ?? V1_DEFAULTS.aspect,
    }),
  };
}

/* ----------------------------------------------------------- as a query -- */

/**
 * The parameter names, which are the part that is frozen.
 *
 * A link is one named parameter per setting rather than one sealed blob, and the
 * reason is the next thing that will read them: a generation endpoint wants the
 * same vocabulary a share link uses, so `?content=…&theme=…` documents both at
 * once. It also means a setting can be changed by editing the URL, which is what
 * anyone will try first.
 *
 * Named parameters version themselves better than a blob, too. A reader ignores
 * a parameter it does not know and defaults one that is missing, so *adding* a
 * setting never breaks an old link. `v` is kept for the changes that shape alone
 * cannot express — if `shadow` ever stopped meaning 0-100, the name would stay
 * the same while the meaning moved, and only a version can catch that.
 */
export const PARAM = {
  version: "v",
  content: "content",
  theme: "theme",
  backdrop: "backdrop",
  syntax: "syntax",
  padding: "padding",
  radius: "radius",
  titleBar: "titleBar",
  title: "title",
  shadow: "shadow",
  columns: "columns",
  aspect: "aspect",
} as const;

/**
 * Every setting is written, never only the ones that differ from a default. It
 * is tempting to omit them — the URL would read better — and it is the same
 * mistake as diffing against defaults inside a blob: the day a default moves,
 * every link that leaned on it renders a different picture than it promised.
 *
 * `content` is the exception to the readability, and deliberately: it is the
 * only part big enough for compression to matter, so the caller hands in an
 * already-encoded blob rather than raw escape sequences, which would triple in
 * length under percent-encoding.
 */
export function toSearchParams(wire: WireWorkspaceV1, encodedContent: string): URLSearchParams {
  const frame = wire.frame ?? {};
  const params = new URLSearchParams();
  params.set(PARAM.version, String(wire.version));
  params.set(PARAM.content, encodedContent);
  params.set(PARAM.theme, wire.theme ?? "");
  params.set(PARAM.backdrop, wire.backdrop ?? "");
  params.set(PARAM.syntax, wire.syntax ?? "");
  params.set(PARAM.padding, String(frame.padding ?? V1_DEFAULTS.padding));
  params.set(PARAM.radius, String(frame.radius ?? V1_DEFAULTS.radius));
  params.set(PARAM.titleBar, (frame.titleBar ?? V1_DEFAULTS.titleBar) ? "1" : "0");
  params.set(PARAM.title, frame.title ?? V1_DEFAULTS.title);
  params.set(PARAM.shadow, String(frame.shadow ?? V1_DEFAULTS.shadow));
  params.set(PARAM.columns, String(frame.columns ?? V1_DEFAULTS.columns));
  // Empty for a free-sized image, the way an absent theme is written empty:
  // there is no default id to spell out, only the absence of one.
  params.set(PARAM.aspect, frame.aspect ?? "");
  return params;
}

/**
 * A boolean the way somebody writes one into a URL by hand.
 *
 * Both vocabularies, because a link is meant to be editable in an address bar
 * and there is no reason to make somebody guess which one this app took. What
 * matters more is the last line: anything *unrecognized* reads as unsaid rather
 * than as true, which is the safer half to freeze forever. `titleBar=nope`
 * meaning "on" is a worse promise to be stuck with than `titleBar=nope` meaning
 * "the link did not say", because only one of the two can be corrected later
 * without changing what an existing link renders.
 */
const WRITTEN_TRUE = new Set(["1", "true", "yes", "on"]);
const WRITTEN_FALSE = new Set(["0", "false", "no", "off"]);

function booleanParam(params: URLSearchParams, name: string): boolean | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const value = raw.trim().toLowerCase();
  if (WRITTEN_TRUE.has(value)) return true;
  if (WRITTEN_FALSE.has(value)) return false;
  return undefined;
}

function numberParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  // `sanitizeFrame` clamps; this only decides whether the caller said anything
  // at all, so nonsense falls through to the default rather than to NaN.
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The wire object a query string describes, or `null` when it does not describe
 * one. `content` is left as the caller passes it in, already decoded.
 */
export function fromSearchParams(params: URLSearchParams, decodedContent: string): WireWorkspaceV1 | null {
  const version = params.get(PARAM.version);
  // Absent means the first version, so a hand-written link can leave it off.
  if (version !== null && version !== "1") return null;

  const titleBar = booleanParam(params, PARAM.titleBar);
  return {
    version: 1,
    content: decodedContent,
    ...(params.get(PARAM.theme) ? { theme: params.get(PARAM.theme)! } : {}),
    ...(params.get(PARAM.backdrop) ? { backdrop: params.get(PARAM.backdrop)! } : {}),
    ...(params.get(PARAM.syntax) ? { syntax: params.get(PARAM.syntax)! } : {}),
    frame: {
      ...(numberParam(params, PARAM.padding) !== undefined ? { padding: numberParam(params, PARAM.padding)! } : {}),
      ...(numberParam(params, PARAM.radius) !== undefined ? { radius: numberParam(params, PARAM.radius)! } : {}),
      ...(titleBar !== undefined ? { titleBar } : {}),
      ...(params.get(PARAM.title) !== null ? { title: params.get(PARAM.title)! } : {}),
      ...(numberParam(params, PARAM.shadow) !== undefined ? { shadow: numberParam(params, PARAM.shadow)! } : {}),
      ...(numberParam(params, PARAM.columns) !== undefined ? { columns: numberParam(params, PARAM.columns)! } : {}),
      ...(params.get(PARAM.aspect) ? { aspect: params.get(PARAM.aspect)! } : {}),
    },
  };
}
