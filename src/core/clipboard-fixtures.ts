/**
 * Rich-text clipboard payloads captured from real terminals, verbatim.
 *
 * Every string here came from an actual copy — select the output, copy, read the
 * flavor back. Terminals differ enough in how they mark up a run that inventing
 * this markup would only test our imagination, so when a new terminal needs
 * supporting, capture it rather than write it.
 *
 * Capture it the way the app receives it, too: read `text/html` off a real paste
 * event, not off the pasteboard. On macOS those differ. A terminal that writes
 * only `public.rtf` still reaches us as HTML, because Chrome converts RTF
 * through NSAttributedString on the way in — so a terminal that looks
 * unsupported when you inspect the pasteboard may be perfectly supportable.
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

/**
 * macOS Terminal.app 2.15 (macOS 26.5.2), copied with a plain Cmd-C.
 *
 * Terminal.app writes no HTML flavour at all — its pasteboard carries
 * `public.rtf` and plain text, nothing else. This is what the *browser* gets
 * anyway: Chrome on macOS reads the RTF into an NSAttributedString and dumps it
 * back out as HTML, so the colours do reach us. That conversion is Chrome's own
 * and exists only on macOS, so these bytes were captured through a real paste
 * event rather than off the pasteboard — nothing else reproduces them.
 *
 * The shape is unlike every other terminal here: the styling lives in
 * class-based CSS in a `<style>` block, not inline, and each row's dominant
 * colour hangs on the `<p>` while the runs that differ override it per
 * `<span>`. A span with no colour of its own is wearing its row's colour.
 */
export const TERMINAL_APP_2_15 = `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta http-equiv="Content-Style-Type" content="text/css">
<title></title>
<meta name="Generator" content="Cocoa HTML Writer">
<meta name="CocoaVersion" content="2685.6">
<style type="text/css">
p.p1 {margin: 0.0px 0.0px 0.0px 0.0px; font: 13.0px Menlo; color: #23bd0e; background-color: #1e1f29}
p.p2 {margin: 0.0px 0.0px 0.0px 0.0px; font: 13.0px Menlo; color: #23bd0e; background-color: #1e1f29; min-height: 15.0px}
p.p3 {margin: 0.0px 0.0px 0.0px 0.0px; font: 13.0px Menlo; color: #205f1e; background-color: #1e1f29}
p.p4 {margin: 0.0px 0.0px 0.0px 0.0px; font: 13.0px Menlo; color: #3ebfcd; background-color: #1e1f29}
span.s1 {font-variant-ligatures: no-common-ligatures; color: #3ebfcd}
span.s2 {font-variant-ligatures: no-common-ligatures}
span.s3 {font-variant-ligatures: no-common-ligatures; color: #642aff}
span.s4 {font-variant-ligatures: no-common-ligatures; color: #d63c29}
span.s5 {font-variant-ligatures: no-common-ligatures; color: #23bd0e}
span.s6 {font-variant-ligatures: no-common-ligatures; color: #e530e4}
span.s7 {font-variant-ligatures: no-common-ligatures; color: #3fc62b}
span.s8 {font-variant-ligatures: no-common-ligatures; color: #1cd705}
</style>
</head>
<body>
<p class="p1"><span class="s1"><b>zshy</b></span><span class="s2"> </span><span class="s3"><b>git:(</b></span><span class="s4"><b>main</b></span><span class="s3"><b>)</b></span><span class="s2"> frizz-dev</span></p>
<p class="p2"><span class="s2"></span><br></p>
<p class="p3"><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s6"><b>FRIZZ</b></span><span class="s5"> </span><span class="s2">v0.2.0</span><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s2">ready in 21s</span></p>
<p class="p2"><span class="s2"></span><br></p>
<p class="p4"><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s7">➜</span><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s8"><b>Local:<span class="Apple-converted-space">\u00a0 \u00a0</span></b></span><span class="s5"> </span><span class="s2">http://127.0.0.1:4918/</span></p>
<p class="p3"><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s7">➜</span><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s8"><b>Project:<span class="Apple-converted-space">\u00a0</span></b></span><span class="s5"> </span><span class="s2">zshy — ~/Documents/projects/zshy</span></p>
<p class="p3"><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s7">➜</span><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s8"><b>Source: <span class="Apple-converted-space">\u00a0</span></b></span><span class="s5"> </span><span class="s2">~/Documents/projects/fray</span></p>
<p class="p3"><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s7">➜</span><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s8"><b>Logs: <span class="Apple-converted-space">\u00a0 \u00a0</span></b></span><span class="s5"> </span><span class="s2">~/.frizz/projects/2c4cddd3-198f-4108-896f-a6dfa5440d8f/logs/frizz-2026-08-05T09-25-29-3704.log</span></p>
<p class="p2"><span class="s2"></span><br></p>
<p class="p3"><span class="s5"><span class="Apple-converted-space">\u00a0 </span></span><span class="s2">press ctrl-c to stop · run with --debug for the full event feed</span></p>
<p class="p2"><span class="s2"></span><br></p>
<p class="p2"><span class="s2"></span><br></p>
</body>
</html>
`;

/** The same selection's `text/plain` flavour. No escape codes survive it. */
export const TERMINAL_APP_2_15_PLAIN = "zshy git:(main) frizz-dev\n\n  FRIZZ v0.2.0  ready in 21s\n\n  ➜  Local:    http://127.0.0.1:4918/\n  ➜  Project:  zshy — ~/Documents/projects/zshy\n  ➜  Source:   ~/Documents/projects/fray\n  ➜  Logs:     ~/.frizz/projects/2c4cddd3-198f-4108-896f-a6dfa5440d8f/logs/frizz-2026-08-05T09-25-29-3704.log\n\n  press ctrl-c to stop · run with --debug for the full event feed\n\n\n";
