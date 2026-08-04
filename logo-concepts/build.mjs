// Emits every Boron logo concept as a standalone SVG plus a contact sheet.
// Run: node logo-concepts/build.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

const BG = "#0f1117";
const FG = "#e7eaf2";
const ACCENT = "#7c5cff";
const DIM = "#5d6577";

/** The tile every concept sits on, so the set reads as one system. */
const tile = (body, { bg = BG } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="28" fill="${bg}"/>
${body}
</svg>
`;

const concepts = {};

// 1. Element tile — Boron is atomic number 5, the element one before carbon.
concepts["01-element-tile"] = tile(`  <text x="22" y="42" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="20" font-weight="500" fill="${ACCENT}">5</text>
  <text x="64" y="96" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="68" font-weight="600" fill="${FG}" text-anchor="middle">B</text>`);

// 2. Chevron-B — the letter's two bowls redrawn as prompt markers.
concepts["02-chevron-b"] = tile(`  <g fill="none" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M42 26 V102" stroke="${FG}"/>
    <path d="M42 26 L74 45 L42 64" stroke="${FG}"/>
    <path d="M42 64 L86 83 L42 102" stroke="${ACCENT}"/>
  </g>`);

// 3. Prompt and cursor — the two glyphs that define a terminal line.
concepts["03-prompt-cursor"] = tile(`  <path d="M30 44 L52 64 L30 84" fill="none" stroke="${ACCENT}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="66" y="42" width="30" height="44" rx="3" fill="${FG}"/>`);

// 4. B12 icosahedron — boron's actual crystal unit is a 12-atom cluster.
concepts["04-icosahedron"] = (() => {
  const pt = (r, deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [64 + r * Math.cos(a), 64 + r * Math.sin(a)];
  };
  const outer = Array.from({ length: 6 }, (_, i) => pt(40, i * 60));
  const inner = Array.from({ length: 6 }, (_, i) => pt(20, i * 60 + 30));
  const edges = [];
  for (let i = 0; i < 6; i++) {
    edges.push([outer[i], outer[(i + 1) % 6]]);
    edges.push([inner[i], inner[(i + 1) % 6]]);
    edges.push([outer[i], inner[i]]);
    edges.push([outer[(i + 1) % 6], inner[i]]);
  }
  const lines = edges
    .map(([a, b]) => `    <line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`)
    .join("\n");
  const dots = [...outer, ...inner]
    .map(([x, y]) => `    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${ACCENT}"/>`)
    .join("\n");
  return tile(`  <g stroke="${DIM}" stroke-width="1.5">
${lines}
  </g>
  <g>
${dots}
  </g>`);
})();

// 5. Grid B — the letter as a 5x7 terminal cell matrix, one cell left as the cursor.
concepts["05-grid-b"] = (() => {
  const rows = [
    "11110",
    "10001",
    "10001",
    "11110",
    "10001",
    "10001",
    "11110",
  ];
  const cell = 11;
  const gap = 2;
  const w = 5 * cell + 4 * gap;
  const h = 7 * cell + 6 * gap;
  const x0 = (128 - w) / 2;
  const y0 = (128 - h) / 2;
  const rects = [];
  rows.forEach((row, r) => {
    [...row].forEach((on, c) => {
      if (on !== "1") return;
      // The last filled cell of the final row reads as the block cursor.
      const isCursor = r === 6 && c === 3;
      rects.push(
        `    <rect x="${x0 + c * (cell + gap)}" y="${y0 + r * (cell + gap)}" width="${cell}" height="${cell}" rx="2" fill="${isCursor ? ACCENT : FG}"/>`,
      );
    });
  });
  return tile(`  <g>\n${rects.join("\n")}\n  </g>`);
})();

// 6. Spectrum B — the letter carrying the palette, because Boron's premise is keeping colors.
concepts["06-spectrum-b"] = (() => {
  const ansi = ["#ff6b81", "#fbbf24", "#4ade80", "#22d3ee", "#60a5fa", "#c084fc"];
  const bars = ansi
    .map((c, i) => `      <rect x="0" y="${24 + i * 14}" width="128" height="14" fill="${c}"/>`)
    .join("\n");
  return tile(`  <defs>
    <mask id="b">
      <rect width="128" height="128" fill="black"/>
      <text x="64" y="97" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="82" font-weight="700" fill="white" text-anchor="middle">B</text>
    </mask>
  </defs>
  <g mask="url(#b)">
${bars}
  </g>`);
})();

const names = Object.keys(concepts);
for (const name of names) writeFileSync(join(OUT, `${name}.svg`), concepts[name]);

const titles = {
  "01-element-tile": "1 · Element tile — B is 5, carbon is 6",
  "02-chevron-b": "2 · Chevron-B — bowls are prompt markers",
  "03-prompt-cursor": "3 · Prompt + cursor",
  "04-icosahedron": "4 · B12 icosahedron",
  "05-grid-b": "5 · Grid B on terminal cells",
  "06-spectrum-b": "6 · Spectrum B",
};

const sheet = `<!doctype html>
<html><head><meta charset="utf-8"><title>Boron logo concepts</title>
<style>
  body { background:#08090d; color:#e7eaf2; font:14px ui-sans-serif,-apple-system,system-ui,sans-serif; margin:0; padding:40px; }
  h1 { font-size:18px; font-weight:600; margin:0 0 4px; }
  p.sub { color:#949cb0; margin:0 0 32px; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:32px; max-width:1000px; }
  .card { background:#0e1016; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:20px; }
  .row { display:flex; align-items:center; gap:20px; margin-bottom:16px; }
  .row img.lg { width:96px; height:96px; }
  .row img.md { width:40px; height:40px; }
  .row img.sm { width:20px; height:20px; }
  .name { color:#949cb0; font-size:12px; }
</style></head><body>
<h1>Boron — logo concepts</h1>
<p class="sub">Each mark shown at 96px, 40px and 20px, so the ones that collapse at favicon size are obvious.</p>
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
</body></html>
`;
writeFileSync(join(OUT, "index.html"), sheet);

console.log(`wrote ${names.length} concepts + contact sheet to ${OUT}`);
