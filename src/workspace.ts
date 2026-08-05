import { parseAnsi } from "./core/ansi.ts";
import { emptyDocument, parsedLinesToDocument, type TerminalDocument } from "./core/document.ts";
import { DEFAULT_THEME, themeById } from "./core/themes.ts";
import { DEFAULT_BACKGROUND_ID, TRANSPARENT_ID, backgroundById } from "./export/background.ts";
import { DEFAULT_FRAME, type FrameSettings } from "./export/layout.ts";

/**
 * The document and every setting that decides what the image looks like.
 *
 * Nothing outside this object feeds the render — type size, line height and the
 * terminal's inner padding are fixed constants, and the face is bundled with the
 * app — so two browsers handed the same `Workspace` draw the same pixels. That
 * is what a share link stakes its promise on, and the reason a new setting has
 * to land here as well as in the sidebar.
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
 * The bounds are wider than the sidebar's sliders on purpose — a drag can push
 * the minimum width past what the slider offers — but they are bounds: a link
 * carrying a padding of a million should open, not hang the tab laying out an
 * image nobody can see.
 */
export function sanitizeFrame(input: unknown): FrameSettings {
  if (typeof input !== "object" || input === null) return { ...DEFAULT_FRAME };
  const frame = input as Partial<FrameSettings>;
  return {
    framePadding: clampedNumber(frame.framePadding, DEFAULT_FRAME.framePadding, 0, 400),
    radius: clampedNumber(frame.radius, DEFAULT_FRAME.radius, 0, 200),
    showChrome: typeof frame.showChrome === "boolean" ? frame.showChrome : DEFAULT_FRAME.showChrome,
    title: typeof frame.title === "string" ? frame.title.slice(0, 200) : DEFAULT_FRAME.title,
    shadowStrength: clampedNumber(frame.shadowStrength, DEFAULT_FRAME.shadowStrength, 0, 100),
    minColumns: Math.round(clampedNumber(frame.minColumns, DEFAULT_FRAME.minColumns, 1, 400)),
  };
}

/** A Slate document, or `null` when the shape isn't one. */
export function sanitizeDocument(input: unknown): TerminalDocument | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const valid = input.every(
    (line: unknown) =>
      typeof line === "object" &&
      line !== null &&
      (line as { type?: unknown }).type === "line" &&
      Array.isArray((line as { children?: unknown }).children) &&
      (line as { children: unknown[] }).children.every(
        (child) => typeof (child as { text?: unknown } | null)?.text === "string",
      ),
  );
  return valid ? (input as TerminalDocument) : null;
}

/** An unknown theme falls back to the default rather than to nothing. */
export function sanitizeThemeId(input: unknown): string {
  return typeof input === "string" ? themeById(input).id : DEFAULT_THEME.id;
}

/**
 * `TRANSPARENT_ID` is a real choice and survives; anything else unrecognized is
 * a typo or a retired gradient, and becomes the default. Passing those through
 * would quietly hand back a transparent image instead.
 */
export function sanitizeBackgroundId(input: unknown): string {
  if (input === TRANSPARENT_ID) return TRANSPARENT_ID;
  if (typeof input === "string" && backgroundById(input)) return input;
  return DEFAULT_BACKGROUND_ID;
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

/* --------------------------------------------------------------- base64 -- */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------- compression -- */

/**
 * Flags the payload's encoding, and is the first character of it. `z` is raw
 * DEFLATE, `u` is the JSON straight up — which is what a script without
 * `CompressionStream` produces, and what makes a link writable by hand.
 */
const DEFLATED = "z";
const PLAIN = "u";

async function pump(
  bytes: Uint8Array<ArrayBuffer>,
  transform: TransformStream<BufferSource, Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = transform.writable.getWriter();
  // Not awaited: the read loop below is what drains the transform, so waiting on
  // the write first would deadlock on a payload larger than one chunk. A corrupt
  // payload fails on both ends of the stream, and the swallowed one here would
  // otherwise surface as an unhandled rejection beside the error the caller
  // already sees from `read`.
  const ignore = () => {};
  void writer.write(bytes).catch(ignore);
  void writer.close().catch(ignore);

  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }

  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* ----------------------------------------------------------- the payload -- */

/**
 * What actually travels in the URL.
 *
 * Every setting is written out in full, never diffed against the defaults: a
 * link is a promise about an image, and a link that renders differently because
 * a default moved underneath it has broken that promise. DEFLATE makes the
 * repetition close to free.
 */
interface SharePayload {
  v: 1;
  /** The document, verbatim. What the app writes. */
  doc?: TerminalDocument;
  /**
   * Terminal output instead of a document — escape sequences and all, parsed on
   * arrival exactly as a paste would be. This is the door for everything that
   * isn't Boron: `boron.sh/#s=u` + base64 of your program's output is a link,
   * with no need to know the editor's schema.
   */
  ansi?: string;
  theme?: string;
  bg?: string;
  frame?: FrameSettings;
}

/** The query/fragment key carrying the payload. */
export const SHARE_PARAM = "s";

/** Encode a workspace for the URL. Compressed when the browser can. */
export async function encodeWorkspace(workspace: Workspace): Promise<string> {
  const payload: SharePayload = {
    v: 1,
    doc: workspace.document,
    theme: workspace.themeId,
    bg: workspace.backgroundId,
    frame: workspace.frame,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream === "undefined") return PLAIN + bytesToBase64Url(bytes);
  try {
    return DEFLATED + bytesToBase64Url(await pump(bytes, new CompressionStream("deflate-raw")));
  } catch {
    return PLAIN + bytesToBase64Url(bytes);
  }
}

/** Read a payload back, or `null` if it is not one. */
export async function decodeWorkspace(payload: string): Promise<Workspace | null> {
  const flag = payload.slice(0, 1);
  const body = base64UrlToBytes(payload.slice(1));
  if (body === null || (flag !== DEFLATED && flag !== PLAIN)) return null;

  let bytes = body;
  if (flag === DEFLATED) {
    if (typeof DecompressionStream === "undefined") return null;
    try {
      bytes = await pump(body, new DecompressionStream("deflate-raw"));
    } catch {
      return null;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const share = parsed as SharePayload;
  if (share.v !== 1) return null;

  const document =
    sanitizeDocument(share.doc) ??
    (typeof share.ansi === "string" ? parsedLinesToDocument(parseAnsi(share.ansi)) : emptyDocument());

  return sanitizeWorkspace(
    { document, themeId: share.theme, backgroundId: share.bg, frame: share.frame },
    document,
  );
}

/* -------------------------------------------------------------- the URL -- */

/**
 * The payload rides in the fragment, so it never reaches a server log, a
 * referrer header or an access log on the way to whoever you sent it to. The
 * query string is read as well, because that is the half of a URL that survives
 * being passed through a tool that only handles one.
 */
export function shareParamFrom(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, "")).get(SHARE_PARAM);
  return fragment ?? parsed.searchParams.get(SHARE_PARAM);
}

export async function buildShareUrl(workspace: Workspace, base: string): Promise<string> {
  const url = new URL(base);
  url.hash = "";
  url.search = "";
  return `${url.href}#${SHARE_PARAM}=${await encodeWorkspace(workspace)}`;
}

/**
 * The shared workspace this page was opened with, if any, taken off the URL.
 *
 * Taken, not read: the address is rewritten once the state is in hand, so that
 * editing what someone sent you and then reloading keeps your edits instead of
 * snapping back to their link.
 */
export async function consumeSharedWorkspace(): Promise<Workspace | null> {
  const payload = shareParamFrom(window.location.href);
  if (payload === null) return null;

  const workspace = await decodeWorkspace(payload);
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.delete(SHARE_PARAM);
    window.history.replaceState(null, "", url.href);
  } catch {
    // Some origins refuse `replaceState`. Losing the tidy-up is not worth
    // losing the workspace that came with it.
  }
  return workspace;
}
