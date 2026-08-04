// Round three: tuning the rainbow terminal-cell B (concept 5 + rainbow).
// Run: node logo-concepts/build-r3.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

const BG = "#0f1117";
const LIGHT_BG = "#f6f7fb";
const FG = "#e7eaf2";

// Boron's own theme colors, in spectrum order.
const ANCHORS = ["#ff6b81", "#fbbf24", "#4ade80", "#22d3ee", "#60a5fa", "#c084fc"];

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (c) => `#${c.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

/** Sample the anchor ramp at t in [0,1], so N rows get N distinct colors. */
function sampleRamp(t) {
  const x = t * (ANCHORS.length - 1);
  const i = Math.min(Math.floor(x), ANCHORS.length - 2);
  const f = x - i;
  const a = hexToRgb(ANCHORS[i]);
  const b = hexToRgb(ANCHORS[i + 1]);
  return rgbToHex(a.map((v, k) => v + (b[k] - v) * f));
}

const ROWS = ["11110", "10001", "10001", "11110", "10001", "10001", "11110"];

/** The 5x7 terminal-cell B. `color(row, col)` picks each cell's fill. */
function gridB(color, { cell = 12.5, gap = 1.5, size = 128 } = {}) {
  const w = 5 * cell + 4 * gap;
  const h = 7 * cell + 6 * gap;
  const x0 = (size - w) / 2;
  const y0 = (size - h) / 2;
  const out = [];
  ROWS.forEach((row, r) => {
    [...row].forEach((on, c) => {
      if (on !== "1") return;
      out.push(
        `    <rect x="${(x0 + c * (cell + gap)).toFixed(2)}" y="${(y0 + r * (cell + gap)).toFixed(2)}" width="${cell}" height="${cell}" rx="1.5" fill="${color(r, c)}"/>`,
      );
    });
  });
  return out.join("\n");
}

const tile = (body, bg = BG) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="28" fill="${bg}"/>
${body}
</svg>
`;

const v = {};

// A. Seven distinct rows sampled off the ramp, so no color repeats top to bottom.
const byRow = (r) => sampleRamp(r / 6);
v["r3-a-ramp-7row"] = tile(`  <g>\n${gridB(byRow)}\n  </g>`);

// B. The ramp running left to right instead, which lines the color up with the
// direction text moves in a terminal.
const byCol = (_r, c) => sampleRamp(c / 4);
v["r3-b-ramp-column"] = tile(`  <g>\n${gridB(byCol)}\n  </g>`);

// C. Ramp by row at heavier cells — fewer gaps means more color per pixel at 16px.
v["r3-c-ramp-heavy"] = tile(`  <g>\n${gridB(byRow, { cell: 13.5, gap: 0.8 })}\n  </g>`);

// D. Only the three horizontal bars carry color; the stems stay foreground.
// Quieter, and the letterform stays crisper when the mark is small.
v["r3-d-bars-only"] = tile(`  <g>\n${gridB((r, c) => ([0, 3, 6].includes(r) ? sampleRamp(r / 6) : FG), { cell: 12.5, gap: 1.5 })}\n  </g>`);

// E. Ramp by row, on a light background, for docs and light-theme READMEs.
v["r3-e-ramp-light"] = tile(`  <g>\n${gridB(byRow)}\n  </g>`, LIGHT_BG);

// F. Ramp by row with no tile behind it, for placing on arbitrary backgrounds.
v["r3-f-ramp-bare"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <g>
${gridB(byRow)}
  </g>
</svg>
`;

for (const [name, svg] of Object.entries(v)) writeFileSync(join(OUT, `${name}.svg`), svg);

// Lockup on the winning treatment.
writeFileSync(
  join(OUT, "r3-lockup.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 128" width="460" height="128">
  <rect width="460" height="128" fill="${BG}"/>
  <g>
${gridB(byRow)}
  </g>
  <text x="152" y="82" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="46" font-weight="500" fill="${FG}" letter-spacing="-1">boron</text>
</svg>
`,
);

const titles = {
  "r3-a-ramp-7row": "A · 7 distinct rows, no repeat",
  "r3-b-ramp-column": "B · Ramp left-to-right",
  "r3-c-ramp-heavy": "C · Heavier cells, tighter gaps",
  "r3-d-bars-only": "D · Color on the three bars only",
  "r3-e-ramp-light": "E · A, on light background",
  "r3-f-ramp-bare": "F · A, no tile (transparent)",
};
const names = Object.keys(titles);

const sheet = `<!doctype html>
<html><head><meta charset="utf-8"><title>Boron — rainbow grid B</title>
<style>
  body { background:#08090d; color:#e7eaf2; font:14px ui-sans-serif,-apple-system,system-ui,sans-serif; margin:0; padding:40px; }
  h1 { font-size:18px; font-weight:600; margin:0 0 4px; }
  h2 { font-size:13px; font-weight:600; margin:34px 0 14px; color:#949cb0; text-transform:uppercase; letter-spacing:.06em; }
  p.sub { color:#949cb0; margin:0 0 8px; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:24px; max-width:1020px; }
  .card { background:#0e1016; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:18px; }
  .row { display:flex; align-items:flex-end; gap:18px; margin-bottom:12px; }
  .row img.lg { width:96px; height:96px; }
  .row img.md { width:32px; height:32px; }
  .row img.sm { width:16px; height:16px; }
  .name { color:#949cb0; font-size:12px; }
  .lock img { display:block; width:340px; border-radius:10px; }
  .ctx { display:flex; align-items:center; gap:10px; background:#1c1f2b; border-radius:8px; padding:8px 12px; width:max-content; }
  .ctx img { width:16px; height:16px; }
  .ctx span { font:12px ui-monospace, monospace; color:#b6c0cf; }
</style></head><body>
<h1>Boron — rainbow terminal-cell B</h1>
<p class="sub">Shown at 96 / 32 / 16px. 16px is the real favicon size, so judge there.</p>
<div class="grid">
${names.map((n) => `  <div class="card">
    <div class="row">
      <img class="lg" src="${n}.svg" alt="${titles[n]}">
      <img class="md" src="${n}.svg" alt="">
      <img class="sm" src="${n}.svg" alt="">
    </div>
    <div class="name">${titles[n]}</div>
  </div>`).join("\n")}
</div>
<h2>In a browser tab, at true size</h2>
<div class="ctx"><img src="r3-a-ramp-7row.svg" alt=""><span>Boron — beautiful images of your terminal</span></div>
<h2>Lockup</h2>
<div class="lock"><img src="r3-lockup.svg" alt="Boron lockup"></div>
</body></html>
`;
writeFileSync(join(OUT, "r3.html"), sheet);
console.log(`wrote ${names.length} variants + lockup`);
