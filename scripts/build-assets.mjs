// Emits the Boron identity — the rainbow terminal-cell B — into public/, which
// Vite copies to the site root verbatim.
//
//   node scripts/build-assets.mjs      writes public/*.svg
//   then: scripts/rasterize.sh         writes public/*.png and favicon.ico
//
// The mark is generated rather than drawn so the cell grid, the gaps and the
// color ramp stay exact, and so any of them can be retuned in one place. The
// same geometry is mirrored in src/ui/Logo.tsx for the in-app header.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");
mkdirSync(OUT, { recursive: true });

const BG = "#0f1117";
const FG = "#e7eaf2";
const DIM = "#949cb0";

// Boron's own theme colors, in spectrum order — the mark is built from the
// palette the app ships, not from a hand-picked gradient.
const ANCHORS = ["#ff6b81", "#fbbf24", "#4ade80", "#22d3ee", "#60a5fa", "#c084fc"];

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (c) => `#${c.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

/** Sample the anchor ramp at t in [0,1], so seven rows get seven distinct colors. */
function sampleRamp(t) {
  const x = t * (ANCHORS.length - 1);
  const i = Math.min(Math.floor(x), ANCHORS.length - 2);
  const f = x - i;
  const a = hexToRgb(ANCHORS[i]);
  const b = hexToRgb(ANCHORS[i + 1]);
  return rgbToHex(a.map((v, k) => v + (b[k] - v) * f));
}

const ROWS = ["11110", "10001", "10001", "11110", "10001", "10001", "11110"];
const ROW_COLOR = ROWS.map((_, r) => sampleRamp(r / (ROWS.length - 1)));

/** The 5x7 terminal-cell B, centered in a `size` box. */
function mark({ size = 128, cell = 12.5, gap = 1.5, cx = size / 2, cy = size / 2, indent = "  " } = {}) {
  const w = 5 * cell + 4 * gap;
  const h = 7 * cell + 6 * gap;
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const out = [];
  ROWS.forEach((row, r) => {
    [...row].forEach((on, c) => {
      if (on !== "1") return;
      out.push(
        `${indent}<rect x="${+(x0 + c * (cell + gap)).toFixed(2)}" y="${+(y0 + r * (cell + gap)).toFixed(2)}" width="${cell}" height="${cell}" rx="1.5" fill="${ROW_COLOR[r]}"/>`,
      );
    });
  });
  return out.join("\n");
}

const files = {};

// The app icon: rounded tile on Boron's own terminal background.
files["mark.svg"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="28" fill="${BG}"/>
${mark()}
</svg>
`;

// Favicon: the tile trimmed to the glyph's own bounds so it stays legible at 16px.
files["favicon.svg"] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="24" fill="${BG}"/>
${mark({ cell: 14, gap: 1.6 })}
</svg>
`;

// The Open Graph card is NOT generated here. It is set in JetBrains Mono, which
// rsvg-convert cannot resolve (see scripts/render-og.sh), so it is authored
// as HTML in scripts/og-card.html and rendered by a browser instead.

for (const [name, svg] of Object.entries(files)) writeFileSync(join(OUT, name), svg);

console.log(`wrote ${Object.keys(files).length} SVGs to public/`);
console.log(`row ramp: ${ROW_COLOR.join(" ")}`);
