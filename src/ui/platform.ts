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
