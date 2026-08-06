import { fromWire, toWire, type WireWorkspaceV1 } from "./wire.ts";
import type { Workspace } from "./workspace.ts";

/**
 * A workspace, in a URL.
 *
 * Everything about *what* travels is decided in `wire.ts`; this file only knows
 * how to get those bytes into an address bar and back. The split is the point —
 * the format is a promise that outlives every link ever sent, and the encoding
 * around it is an implementation detail that can change tomorrow.
 */

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
 * The first character of the payload says how the rest is encoded. `z` is raw
 * DEFLATE; `u` is the JSON straight up, which is what a script without a
 * compressor produces and what keeps a link writable by hand.
 */
const DEFLATED = "z";
const PLAIN = "u";

/**
 * The most a payload may weigh once unpacked. DEFLATE turns a few hundred bytes
 * of link into hundreds of megabytes of repeated text quite happily, and the
 * receiver has no say in what arrives — so the ceiling is here, on the way in,
 * rather than left to whatever runs out of memory first.
 */
const MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024;

async function pump(
  bytes: Uint8Array<ArrayBuffer>,
  transform: TransformStream<BufferSource, Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = transform.writable.getWriter();
  // Not awaited: the read loop below is what drains the transform, so waiting on
  // the write first would deadlock on anything larger than a chunk. A corrupt
  // payload fails at both ends, and the rejection swallowed here would otherwise
  // surface as an unhandled one beside the error `read` already reports.
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
    if (length > MAX_DECOMPRESSED_BYTES) {
      await reader.cancel();
      throw new Error("Shared workspace is too large");
    }
  }

  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* ---------------------------------------------------------- the payload -- */

export const SHARE_PARAM = "s";

export async function encodeShare(workspace: Workspace): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(toWire(workspace)));
  if (typeof CompressionStream === "undefined") return PLAIN + bytesToBase64Url(bytes);
  try {
    return DEFLATED + bytesToBase64Url(await pump(bytes, new CompressionStream("deflate-raw")));
  } catch {
    return PLAIN + bytesToBase64Url(bytes);
  }
}

export async function decodeShare(payload: string): Promise<Workspace | null> {
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

  try {
    return fromWire(JSON.parse(new TextDecoder().decode(bytes)) as WireWorkspaceV1);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- the URL -- */

/**
 * How long a link may get before the payload goes back in the fragment.
 *
 * A fragment is never sent to the server, so it has no practical length limit; a
 * query string travels in the request line, which servers and CDNs cap somewhere
 * around 8-16KB. Past this a query link would start coming back as a 414 from
 * somebody else's proxy, and a link that works is worth more than a link that
 * could carry a preview card.
 */
const MAX_QUERY_URL_LENGTH = 8000;

/**
 * Both halves are read: the query string is what links are written as, and the
 * fragment is what the long ones fall back to.
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

/**
 * The payload goes in the query string rather than the fragment because a
 * fragment never reaches the server, and a preview card can only ever be built
 * from something the server is told about.
 */
export async function buildShareUrl(workspace: Workspace, base: string): Promise<string> {
  const url = new URL(base);
  url.hash = "";
  url.search = "";
  const payload = await encodeShare(workspace);
  const query = `${url.href}?${SHARE_PARAM}=${payload}`;
  return query.length <= MAX_QUERY_URL_LENGTH ? query : `${url.href}#${SHARE_PARAM}=${payload}`;
}

/**
 * The shared workspace this page was opened with, taken off the URL.
 *
 * Taken, not read: the address is rewritten once the state is in hand, so that
 * editing what someone sent you and then reloading keeps your edits rather than
 * snapping back to their link.
 */
export async function consumeSharedWorkspace(): Promise<Workspace | null> {
  const payload = shareParamFrom(window.location.href);
  if (payload === null) return null;

  const workspace = await decodeShare(payload);
  try {
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.delete(SHARE_PARAM);
    window.history.replaceState(null, "", url.href);
  } catch {
    // Some origins refuse `replaceState`. Losing the tidy-up is not worth losing
    // the workspace that came with it.
  }
  return workspace;
}
