/**
 * Rich-text clipboard payloads captured from real terminals, verbatim.
 *
 * Every string here came off an actual system pasteboard — select the output,
 * copy, read the `text/html` flavor back. Terminals differ enough in how they
 * mark up a run that inventing this markup would only test our imagination, so
 * when a new terminal needs supporting, capture it rather than write it.
 */

/**
 * Ghostty 1.3.1 (macOS, `copy_to_clipboard:mixed`).
 *
 * Every styled run is a `<div>` carrying `display: inline`, inside one
 * `white-space: pre` wrapper. Real line breaks are literal newlines in that
 * wrapper's text, not markup — so the `display` declaration is the only thing
 * separating a run from a row.
 */
export const GHOSTTY_1_3_1 =
  '<div style="font-family: monospace; white-space: pre;">' +
  '<div style="display: inline;color: rgb(178, 148, 187);font-weight: bold;">FRAY</div> ' +
  '<div style="display: inline;opacity: 0.5;">v0.1.5</div>  ' +
  '<div style="display: inline;opacity: 0.5;">ready in 2.9s</div>\n' +
  "\n" +
  '  <div style="display: inline;color: rgb(181, 189, 104);">&#10140;</div>  ' +
  '<div style="display: inline;font-weight: bold;">Local:</div>   ' +
  '<div style="display: inline;color: rgb(138, 190, 183);text-decoration-line: underline;text-decoration-style: solid;">http://127.0.0.1:4919/</div>\n' +
  '  <div style="display: inline;color: rgb(234, 234, 234);background-color: rgb(204, 102, 102);"> RED BG </div> plain ' +
  '<div style="display: inline;font-style: italic;">italic</div> ' +
  '<div style="display: inline;text-decoration-line: line-through;">strike</div>\n' +
  '<div style="display: inline;color: rgb(255, 135, 0);">256color</div> ' +
  '<div style="display: inline;color: rgb(10, 200, 30);">truecolor</div> trailing-plain' +
  "</div>";

/** The same selection's `text/plain` flavor, for comparison. Ghostty's is clean. */
export const GHOSTTY_1_3_1_PLAIN =
  "FRAY v0.1.5  ready in 2.9s\n" +
  "\n" +
  "  ➜  Local:   http://127.0.0.1:4919/\n" +
  "   RED BG  plain italic strike\n" +
  "256color truecolor trailing-plain";
