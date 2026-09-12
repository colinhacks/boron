/**
 * What to call the box-selection modifier on this machine.
 *
 * A hidden gesture nobody is told about is a gesture nobody uses, and the legend
 * under the block is the only place the app says it — so it has to say the key
 * the reader actually has. `⌥` is a Mac key. On Windows and Linux the same
 * gesture is Alt, and printing the Mac glyph there names a key that is not on
 * the keyboard.
 */
export function altLabelFor(...platformHints: (string | undefined)[]): string {
  return /mac/i.test(platformHints.filter(Boolean).join(" ")) ? "⌥" : "Alt";
}

/**
 * The hints are *joined* rather than taken in preference order, and that is the
 * whole subtlety: Chrome answers `userAgentData.platform` with an **empty
 * string** on macOS unless the hint is explicitly requested, and `??` treats an
 * empty string as a present value — which silently told every Mac to press
 * "Alt". `navigator.platform` is deprecated but is the one that answers.
 * Measured in a browser, not assumed.
 */
export const ALT_LABEL = altLabelFor(
  (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform,
  navigator.platform,
);

/**
 * How often this browser will let the address bar be rewritten, in ms.
 *
 * This is not about rendering cost, and it is worth saying so because the cheap
 * assumption is that it must be. Writing the address is free: `replaceState`
 * re-renders nothing, and the DEFLATE pass behind it measures a quarter of a
 * millisecond for any document short enough to fit in a URL at all. Removing the
 * throttle entirely holds a steady sixty frames a second.
 *
 * It is about a hard limit that *throws*. Every engine rate-limits
 * `history.replaceState`; WebKit's is the one that bites, raising a
 * `SecurityError` rather than ignoring the call. The documented ceiling is 100
 * calls per 30 seconds, which Safari 17 relaxed considerably.
 *
 * One drag of the width slider spends **180** of those 100 calls — measured,
 * unthrottled, over three seconds at 60Hz. So this is not a margin being
 * defended against a hypothetical: a single ordinary gesture is already
 * comfortably over the budget, and on Safari the second half of that drag would
 * throw and the address would quietly stop tracking.
 *
 * The three numbers are [nuqs](https://nuqs.dev)'s, and they are here because
 * that library exists to do exactly this and has had far more browsers pointed
 * at it than this app ever will. Blink and Gecko are happy at 50ms; picking one
 * number conservative enough for old WebKit would make every other browser feel
 * broken for no reason.
 *
 * These bound how often the *address* is rewritten, and nothing else. What is on
 * screen never waits on this.
 */
export function urlWriteIntervalFor(hasGestureEvent: boolean, userAgent: string): number {
  // `GestureEvent` is WebKit-only, and the sniff nuqs settled on. A UA string
  // alone would catch every Chrome on iOS, which is WebKit underneath but is not
  // what the version in the UA describes.
  if (!hasGestureEvent) return 50;
  const version = Number.parseFloat(/version\/([\d.]+) safari/i.exec(userAgent)?.[1] ?? "");
  // An unreadable version is treated as old, because guessing high here is the
  // failure that throws.
  return version >= 17 ? 120 : 320;
}

export const URL_WRITE_INTERVAL = urlWriteIntervalFor(
  "GestureEvent" in window,
  navigator.userAgent,
);
