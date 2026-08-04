// Round two: the survivors refined, plus a rainbow set built from Boron's own ANSI palette.
// Run: node logo-concepts/build-r2.mjs

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));

const BG = "#0f1117";
const FG = "#e7eaf2";
const ACCENT = "#7c5cff";

// The Boron theme's own ANSI colors, in chalk order — the actual palette the app ships.
const ANSI = {
  red: "#ff6b81",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
};
// Spectrum order, so the ramp reads as a rainbow rather than as chalk's argument order.
const RAMP = [ANSI.red, ANSI.yellow, ANSI.green, ANSI.cyan, ANSI.blue, ANSI.magenta];

const tile = (body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
${defs}  <rect width="128" height="128" rx="28" fill="${BG}"/>
${body}
</svg>
`;

const v = {};

/** The 5x7 terminal-cell B. `color(row, col)` picks each cell's fill. */
const gridB = (cell, gap, color) => {
  const rows = ["11110", "10001", "10001", "11110", "10001", "10001", "11110"];
  const w = 5 * cell + 4 * gap;
  const h = 7 * cell + 6 * gap;
  const x0 = (128 - w) / 2;
  const y0 = (128 - h) / 2;
  const out = [];
  rows.forEach((row, r) => {
    [...row].forEach((on, c) => {
      if (on !== "1") return;
      out.push(
        `    <rect x="${(x0 + c * (cell + gap)).toFixed(1)}" y="${(y0 + r * (cell + gap)).toFixed(1)}" width="${cell}" height="${cell}" rx="1.5" fill="${color(r, c)}"/>`,
      );
    });
  });
  return out.join("\n");
};

// --- Rainbow set -----------------------------------------------------------

// R1. Each terminal row takes the next palette color. Discrete, so it reads as
// "the sixteen named colors" rather than as a generic gradient.
v["r2-rainbow-grid-rows"] = tile(`  <g>\n${gridB(12.5, 1.5, (r) => RAMP[r % RAMP.length])}\n  </g>`);

// R2. The ramp runs diagonally, which keeps adjacent cells distinct in both axes.
v["r2-rainbow-grid-diagonal"] = tile(`  <g>\n${gridB(12.5, 1.5, (r, c) => RAMP[(r + c) % RAMP.length])}\n  </g>`);

// R3. Mostly foreground, with the palette entering only on the stem — quieter,
// and it still reads as Boron at 18px where a full rainbow turns to mud.
v["r2-rainbow-grid-stem"] = tile(`  <g>\n${gridB(12.5, 1.5, (r, c) => (c === 0 ? RAMP[r % RAMP.length] : FG))}\n  </g>`);

// R4. Solid letterform masked over discrete palette bands.
v["r2-rainbow-bands"] = tile(
  `  <g mask="url(#letterB)">
${RAMP.map((c, i) => `    <rect x="0" y="${20 + i * 15}" width="128" height="15" fill="${c}"/>`).join("\n")}
  </g>`,
  `  <defs>
    <mask id="letterB">
      <rect width="128" height="128" fill="black"/>
      <text x="64" y="98" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="86" font-weight="700" fill="white" text-anchor="middle">B</text>
    </mask>
  </defs>
`,
);

// R5. The same letterform over a smooth ramp, for comparison against R4.
v["r2-rainbow-gradient"] = tile(
  `  <text x="64" y="98" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="86" font-weight="700" fill="url(#ramp)" text-anchor="middle">B</text>`,
  `  <defs>
    <linearGradient id="ramp" x1="0" y1="0" x2="0.4" y2="1">
${RAMP.map((c, i) => `      <stop offset="${((i / (RAMP.length - 1)) * 100).toFixed(0)}%" stop-color="${c}"/>`).join("\n")}
    </linearGradient>
  </defs>
`,
);

// R6. Chevron-B carrying the ramp across its two bowls.
v["r2-rainbow-chevron"] = tile(
  `  <g fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 24 V104" stroke="${ANSI.magenta}"/>
    <path d="M40 24 L72 43 L40 62" stroke="${ANSI.cyan}"/>
    <path d="M40 66 L80 85 L40 104" stroke="${ANSI.yellow}"/>
  </g>`,
);

// --- Monochrome survivors, refined ----------------------------------------

// Chevron-B with true B proportions: upper bowl shorter, both bowls closed on the stem.
v["r2-chevron-b-balanced"] = tile(`  <g fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 24 V104" stroke="${FG}"/>
    <path d="M40 24 L72 43 L40 62" stroke="${FG}"/>
    <path d="M40 66 L80 85 L40 104" stroke="${ACCENT}"/>
  </g>`);

// The same mark as solid counters — heavier, holds together at favicon size.
v["r2-chevron-b-solid"] = tile(`  <g stroke-linejoin="round">
    <path d="M34 22 h10 v84 h-10 z" fill="${FG}"/>
    <path d="M44 24 L76 43 L44 62 z" fill="${FG}"/>
    <path d="M44 66 L84 85 L44 104 z" fill="${ACCENT}"/>
  </g>`);

// Grid B at tighter gaps, cursor cell in accent.
v["r2-grid-b-tight"] = tile(`  <g>\n${gridB(12.5, 1.5, (r, c) => (r === 6 && c === 3 ? ACCENT : FG))}\n  </g>`);

const names = Object.keys(v);
for (const n of names) writeFileSync(join(OUT, `${n}.svg`), v[n]);

// Horizontal lockups: mark plus wordmark, which is what a README and an OG card need.
const lockup = (markBody) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 128" width="460" height="128">
  <rect width="460" height="128" fill="${BG}"/>
  <g>${markBody}</g>
  <text x="150" y="82" font-family="ui-monospace, 'JetBrains Mono', monospace" font-size="46" font-weight="500" fill="${FG}" letter-spacing="-1">boron</text>
</svg>
`;
writeFileSync(join(OUT, "r2-lockup-rainbow-grid.svg"), lockup(`<g>\n${gridB(12.5, 1.5, (r) => RAMP[r % RAMP.length])}\n  </g>`));
writeFileSync(join(OUT, "r2-lockup-chevron.svg"), lockup(`<g fill="none" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 24 V104" stroke="${FG}"/>
    <path d="M40 24 L72 43 L40 62" stroke="${FG}"/>
    <path d="M40 66 L80 85 L40 104" stroke="${ACCENT}"/>
  </g>`));

const titles = {
  "r2-rainbow-grid-rows": "R1 · Rainbow grid B — palette by row",
  "r2-rainbow-grid-diagonal": "R2 · Rainbow grid B — diagonal ramp",
  "r2-rainbow-grid-stem": "R3 · Rainbow on the stem only",
  "r2-rainbow-bands": "R4 · Solid B over discrete bands",
  "r2-rainbow-gradient": "R5 · Solid B over smooth gradient",
  "r2-rainbow-chevron": "R6 · Chevron-B in palette colors",
  "r2-chevron-b-balanced": "2a · Chevron-B, balanced (mono)",
  "r2-chevron-b-solid": "2b · Chevron-B, solid (mono)",
  "r2-grid-b-tight": "5a · Grid B, cursor cell (mono)",
};

const sheet = `<!doctype html>
<html><head><meta charset="utf-8"><title>Boron logo concepts — round 2</title>
<style>
  body { background:#08090d; color:#e7eaf2; font:14px ui-sans-serif,-apple-system,system-ui,sans-serif; margin:0; padding:40px; }
  h1 { font-size:18px; font-weight:600; margin:0 0 4px; }
  h2 { font-size:13px; font-weight:600; margin:34px 0 14px; color:#949cb0; text-transform:uppercase; letter-spacing:.06em; }
  p.sub { color:#949cb0; margin:0 0 8px; }
  .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:24px; max-width:1020px; }
  .card { background:#0e1016; border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:18px; }
  .row { display:flex; align-items:center; gap:18px; margin-bottom:12px; }
  .row img.lg { width:88px; height:88px; }
  .row img.md { width:36px; height:36px; }
  .row img.sm { width:18px; height:18px; }
  .name { color:#949cb0; font-size:12px; }
  .lock img { display:block; width:340px; margin-bottom:14px; border-radius:10px; }
</style></head><body>
<h1>Boron — round 2</h1>
<p class="sub">Rainbow set first. Every mark at 88 / 36 / 18px, so anything that turns to mud at favicon size shows it here.</p>
<h2>Rainbow</h2>
<div class="grid">
${names.slice(0, 6).map((n) => `  <div class="card">
    <div class="row">
      <img class="lg" src="${n}.svg" alt="${titles[n]}">
      <img class="md" src="${n}.svg" alt="">
      <img class="sm" src="${n}.svg" alt="">
    </div>
    <div class="name">${titles[n]}</div>
  </div>`).join("\n")}
</div>
<h2>Monochrome survivors</h2>
<div class="grid">
${names.slice(6).map((n) => `  <div class="card">
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
  <img src="r2-lockup-rainbow-grid.svg" alt="Rainbow grid B lockup">
  <img src="r2-lockup-chevron.svg" alt="Chevron-B lockup">
</div>
</body></html>
`;
writeFileSync(join(OUT, "r2.html"), sheet);
console.log(`wrote ${names.length} marks + 2 lockups`);
