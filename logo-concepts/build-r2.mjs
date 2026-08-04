// Round two: the three concepts that survived small sizes, refined, plus wordmark lockups.
// Run: node logo-concepts/build-r2.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

const BG = "#0f1117";
const FG = "#e7eaf2";
const ACCENT = "#7c5cff";

const tile = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="28" fill="${BG}"/>
${body}
</svg>
`;

const v = {};

// 2a. Chevron-B with true B proportions: upper bowl shorter, both bowls closed on the stem.
v["r2-chevron-b-balanced"] = tile(`  <g fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 24 V104" stroke="${FG}"/>
    <path d="M40 24 L72 43 L40 62" stroke="${FG}"/>
    <path d="M40 66 L80 85 L40 104" stroke="${ACCENT}"/>
  </g>`);

// 2b. The same mark as solid counters — heavier, holds together at favicon size.
v["r2-chevron-b-solid"] = tile(`  <g stroke-linejoin="round">
    <path d="M34 22 h10 v84 h-10 z" fill="${FG}"/>
    <path d="M44 24 L76 43 L44 62 z" fill="${FG}"/>
    <path d="M44 66 L84 85 L44 104 z" fill="${ACCENT}"/>
  </g>`);

// 2c. Chevron-B where the lower bowl is left open, so the mark also reads as a bare prompt.
v["r2-chevron-b-open"] = tile(`  <g fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 24 V104" stroke="${FG}"/>
    <path d="M40 24 L72 43 L40 62" stroke="${FG}"/>
    <path d="M40 66 L80 85" stroke="${ACCENT}"/>
  </g>`);

// 5a. Grid B at tighter gaps, so the counters stay open when the mark is 16px.
const gridB = (cell, gap, cursor) => {
  const rows = ["11110", "10001", "10001", "11110", "10001", "10001", "11110"];
  const w = 5 * cell + 4 * gap;
  const h = 7 * cell + 6 * gap;
  const x0 = (128 - w) / 2;
  const y0 = (128 - h) / 2;
  const out = [];
  rows.forEach((row, r) => {
    [...row].forEach((on, c) => {
      if (on !== "1") return;
      const isCursor = cursor && r === cursor[0] && c === cursor[1];
      out.push(
        `    <rect x="${(x0 + c * (cell + gap)).toFixed(1)}" y="${(y0 + r * (cell + gap)).toFixed(1)}" width="${cell}" height="${cell}" rx="1.5" fill="${isCursor ? ACCENT : FG}"/>`,
      );
    });
  });
  return out.join("\n");
};

v["r2-grid-b-tight"] = tile(`  <g>\n${gridB(12.5, 1.5, [6, 3])}\n  </g>`);
v["r2-grid-b-mono"] = tile(`  <g>\n${gridB(12.5, 1.5, null)}\n  </g>`);

// 1a. Element tile with the atomic number promoted to a structural element rather than a detail.
v["r2-element-tile"] = tile(`  <text x="64" y="88" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="62" font-weight="600" fill="${FG}" text-anchor="middle" letter-spacing="-2">B<tspan font-size="30" fill="${ACCENT}" dy="8">5</tspan></text>`);

const names = Object.keys(v);
for (const n of names) writeFileSync(join(OUT, `${n}.svg`), v[n]);

// Horizontal lockups: the mark next to the wordmark, which is what a README and an OG card need.
const lockup = (markBody, id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 128" width="460" height="128">
  <rect width="460" height="128" fill="${BG}"/>
  <g>${markBody}</g>
  <text x="150" y="82" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="46" font-weight="500" fill="${FG}" letter-spacing="-1">boron</text>
</svg>
`;

const chevronMark = `<g fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 24 V104" stroke="${FG}"/>
    <path d="M40 24 L72 43 L40 62" stroke="${FG}"/>
    <path d="M40 66 L80 85 L40 104" stroke="${ACCENT}"/>
  </g>`;
writeFileSync(join(OUT, "r2-lockup-chevron.svg"), lockup(chevronMark));
writeFileSync(join(OUT, "r2-lockup-grid.svg"), lockup(`<g>\n${gridB(12.5, 1.5, [6, 3])}\n  </g>`));

const titles = {
  "r2-chevron-b-balanced": "2a · Chevron-B, balanced bowls",
  "r2-chevron-b-solid": "2b · Chevron-B, solid",
  "r2-chevron-b-open": "2c · Chevron-B, open lower bowl",
  "r2-grid-b-tight": "5a · Grid B, tight cells + cursor",
  "r2-grid-b-mono": "5b · Grid B, monochrome",
  "r2-element-tile": "1a · Element tile, B5 as one glyph",
};

const sheet = `<!doctype html>
<html><head><meta charset="utf-8"><title>Boron logo concepts — round 2</title>
<style>
  body { background:#08090d; color:#e7eaf2; font:14px ui-sans-serif,-apple-system,system-ui,sans-serif; margin:0; padding:40px; }
  h1 { font-size:18px; font-weight:600; margin:0 0 4px; }
  h2 { font-size:14px; font-weight:600; margin:36px 0 16px; color:#949cb0; }
  p.sub { color:#949cb0; margin:0 0 8px; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:28px; max-width:1000px; }
  .card { background:#0e1016; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:20px; }
  .row { display:flex; align-items:center; gap:20px; margin-bottom:14px; }
  .row img.lg { width:88px; height:88px; }
  .row img.md { width:36px; height:36px; }
  .row img.sm { width:18px; height:18px; }
  .name { color:#949cb0; font-size:12px; }
  .lock img { display:block; width:360px; margin-bottom:16px; border-radius:10px; }
</style></head><body>
<h1>Boron — round 2</h1>
<p class="sub">The survivors, refined. Same 88 / 36 / 18px ladder.</p>
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
<h2>Lockups</h2>
<div class="lock">
  <img src="r2-lockup-chevron.svg" alt="Chevron-B lockup">
  <img src="r2-lockup-grid.svg" alt="Grid B lockup">
</div>
</body></html>
`;
writeFileSync(join(OUT, "r2.html"), sheet);
console.log(`wrote ${names.length} refinements + 2 lockups`);
