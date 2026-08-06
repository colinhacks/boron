import { sanitizeDocument, type TerminalDocument } from "./core/document.ts";
import { DEFAULT_THEME, themeById } from "./core/themes.ts";
import {
  DEFAULT_BACKGROUND_ID,
  TRANSPARENT_ID,
  backgroundById,
  isFillId,
  normalizeFillId,
} from "./export/background.ts";
import { DEFAULT_FRAME, MAX_TITLE_LENGTH, type FrameSettings } from "./export/layout.ts";

/**
 * The document and every setting that decides what the image looks like.
 *
 * Nothing outside this object feeds the render — type size, line height and the
 * terminal's inner padding are fixed constants, and the face is bundled with the
 * app — so two browsers handed the same `Workspace` draw the same pixels.
 *
 * This is an *internal* shape, persisted to `localStorage` and nowhere else. It
 * deliberately is not a wire format: see wiki/share-links.md for why putting the
 * Slate document in a URL was pulled back out.
 */
export interface Workspace {
  document: TerminalDocument;
  themeId: string;
  backgroundId: string;
  frame: FrameSettings;
}

/* ------------------------------------------------------------ sanitizing -- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

/**
 * A frame from an untrusted source, clamped to what the app can actually draw.
 *
 * The bounds are wider than the controls on purpose — a stored workspace predates
 * whatever range they offer today — but they are bounds: a link carrying a
 * padding of a million should open, not hang the tab laying out an image nobody
 * can see.
 */
export function sanitizeFrame(input: unknown): FrameSettings {
  if (typeof input !== "object" || input === null) return { ...DEFAULT_FRAME };
  const frame = input as Partial<FrameSettings>;
  return {
    framePadding: clampedNumber(frame.framePadding, DEFAULT_FRAME.framePadding, 0, 400),
    radius: clampedNumber(frame.radius, DEFAULT_FRAME.radius, 0, 200),
    showChrome: typeof frame.showChrome === "boolean" ? frame.showChrome : DEFAULT_FRAME.showChrome,
    title: typeof frame.title === "string" ? frame.title.slice(0, MAX_TITLE_LENGTH) : DEFAULT_FRAME.title,
    shadowStrength: clampedNumber(frame.shadowStrength, DEFAULT_FRAME.shadowStrength, 0, 100),
    columns: Math.round(clampedNumber(frame.columns, DEFAULT_FRAME.columns, 1, 400)),
  };
}

export { sanitizeDocument };

/** An unknown theme falls back to the default rather than to nothing. */
export function sanitizeThemeId(input: unknown): string {
  return typeof input === "string" ? themeById(input).id : DEFAULT_THEME.id;
}

/**
 * `TRANSPARENT_ID` is a real choice and survives; so is a `#rrggbb` fill, which
 * is a colour rather than a name and so cannot be checked against a list — the
 * syntax is the whole check, and anything that is not it never reaches a
 * renderer. Case is folded because `#FF6600` and `#ff6600` are one choice, and
 * two spellings of it would light two swatches in the picker.
 *
 * Anything else unrecognized is a typo or a retired gradient, and becomes the
 * default. Passing those through would quietly hand back a transparent image.
 */
export function sanitizeBackgroundId(input: unknown): string {
  if (input === TRANSPARENT_ID) return TRANSPARENT_ID;
  if (typeof input !== "string") return DEFAULT_BACKGROUND_ID;
  if (isFillId(input)) return normalizeFillId(input);
  return backgroundById(input) ? input : DEFAULT_BACKGROUND_ID;
}

/**
 * Fill in a whole workspace, whatever the input turns out to be. Every field is
 * decided here, so a payload that names only the text still renders the same way
 * for everyone who opens it — the reader's own settings never leak in.
 */
export function sanitizeWorkspace(input: unknown, document: TerminalDocument): Workspace {
  const state = (typeof input === "object" && input !== null ? input : {}) as Partial<Workspace>;
  return {
    document: sanitizeDocument(state.document) ?? document,
    themeId: sanitizeThemeId(state.themeId),
    backgroundId: sanitizeBackgroundId(state.backgroundId),
    frame: sanitizeFrame(state.frame),
  };
}
