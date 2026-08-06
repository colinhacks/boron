import { PARAM, fromSearchParams, toSearchParams, toWire, fromWire } from "./wire.ts";
import type { Workspace } from "./workspace.ts";

/**
 * A workspace, in a URL.
 *
 * `wire.ts` owns *what* travels and what the parameters are called; this file
 * only knows how to get those names and values into an address bar and back. The
 * split is the point — the vocabulary is a promise that outlives every link ever
 * sent, and the encoding around it is an implementation detail.
 */

/* --------------------------------------------------------- the content -- */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * The first character of `content` says how the rest is encoded: `z` is raw
 * DEFLATE, `u` is the bytes straight up. The `u` form is what a script without a
 * compressor writes, and it is the reason a link is still constructible by hand
 * — base64 exists everywhere; a DEFLATE implementation does not.
 */
const DEFLATED = "z";
const PLAIN = "u";

/**
 * The most the content may weigh once unpacked. DEFLATE turns a few hundred
 * bytes of link into hundreds of megabytes of repeated text quite happily, and
 * the receiver has no say in what arrives — so the ceiling is here, on the way
 * in, rather than left to whatever runs out of memory first.
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
      throw new Error("Shared content is too large");
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

export async function encodeContent(ansi: string): Promise<string> {
  const bytes = new TextEncoder().encode(ansi);
  if (typeof CompressionStream === "undefined") return PLAIN + bytesToBase64Url(bytes);
  try {
    return DEFLATED + bytesToBase64Url(await pump(bytes, new CompressionStream("deflate-raw")));
  } catch {
    return PLAIN + bytesToBase64Url(bytes);
  }
}

export async function decodeContent(value: string): Promise<string | null> {
  const flag = value.slice(0, 1);
  const body = base64UrlToBytes(value.slice(1));
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
  return new TextDecoder().decode(bytes);
}

/* -------------------------------------------------------------- the URL -- */

/**
 * How long a link may get before the parameters move to the fragment.
 *
 * A fragment is never sent to the server, so it has no practical length limit; a
 * query string travels in the request line, which servers and CDNs cap somewhere
 * around 8-16KB. Past this a query link would start coming back as a 414 from
 * somebody else's proxy, and a link that works beats a link a crawler can read.
 */
const MAX_QUERY_URL_LENGTH = 8000;

/** The parameters a URL carries, from whichever half of it they are in. */
export function shareParamsFrom(url: string): URLSearchParams | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  if (fragment.has(PARAM.content)) return fragment;
  return parsed.searchParams.has(PARAM.content) ? parsed.searchParams : null;
}

/**
 * The parameters go in the query string rather than the fragment, because a
 * fragment never reaches the server and an image endpoint can only be handed
 * something the server is told about.
 */
export async function buildShareUrl(workspace: Workspace, base: string): Promise<string> {
  const url = new URL(base);
  url.hash = "";
  url.search = "";
  const wire = toWire(workspace);
  const params = toSearchParams(wire, await encodeContent(wire.content)).toString();

  const query = `${url.href}?${params}`;
  return query.length <= MAX_QUERY_URL_LENGTH ? query : `${url.href}#${params}`;
}

export async function readSharedWorkspace(url: string): Promise<Workspace | null> {
  const params = shareParamsFrom(url);
  if (!params) return null;

  const content = await decodeContent(params.get(PARAM.content) ?? "");
  if (content === null) return null;

  return fromWire(fromSearchParams(params, content));
}

/**
 * The shared workspace this page was opened with, taken off the URL.
 *
 * Taken, not read: the address is rewritten once the state is in hand, so that
 * editing what someone sent you and then reloading keeps your edits rather than
 * snapping back to their link.
 */
export async function consumeSharedWorkspace(): Promise<Workspace | null> {
  const workspace = await readSharedWorkspace(window.location.href);
  if (shareParamsFrom(window.location.href) === null) return null;

  try {
    const url = new URL(window.location.href);
    url.hash = "";
    for (const name of Object.values(PARAM)) url.searchParams.delete(name);
    window.history.replaceState(null, "", url.href);
  } catch {
    // Some origins refuse `replaceState`. Losing the tidy-up is not worth losing
    // the workspace that came with it.
  }
  return workspace;
}
