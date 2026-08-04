export interface Background {
  id: string;
  name: string;
  /** CSS angle in degrees: 0 points up, increasing clockwise. */
  angle: number;
  stops: readonly string[];
}

/** `null` means a transparent frame — the PNG keeps its alpha channel. */
export const TRANSPARENT_ID = "none";

export const BACKGROUNDS: readonly Background[] = [
  { id: "midnight", name: "Midnight", angle: 135, stops: ["#1e3a8a", "#6d28d9"] },
  { id: "ember", name: "Ember", angle: 135, stops: ["#f97316", "#db2777"] },
  { id: "mint", name: "Mint", angle: 135, stops: ["#059669", "#0891b2"] },
  { id: "dusk", name: "Dusk", angle: 160, stops: ["#f43f5e", "#7c3aed", "#2563eb"] },
  { id: "sand", name: "Sand", angle: 135, stops: ["#fbbf24", "#f472b6"] },
  { id: "arctic", name: "Arctic", angle: 135, stops: ["#67e8f9", "#3b82f6"] },
  { id: "graphite", name: "Graphite", angle: 135, stops: ["#334155", "#0f172a"] },
  { id: "ink", name: "Ink", angle: 0, stops: ["#0b0d12", "#0b0d12"] },
];

export function backgroundById(id: string): Background | null {
  return BACKGROUNDS.find((background) => background.id === id) ?? null;
}

export function backgroundCss(background: Background | null): string {
  if (!background) return "transparent";
  return `linear-gradient(${background.angle}deg, ${background.stops.join(", ")})`;
}

/**
 * The gradient line for a CSS angle, in canvas coordinates. CSS measures from
 * "up" and turns clockwise, and the line is sized so the gradient reaches the
 * corners exactly — the same geometry a browser uses.
 */
export function gradientEndpoints(
  angle: number,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x0: cx - (dx * length) / 2,
    y0: cy - (dy * length) / 2,
    x1: cx + (dx * length) / 2,
    y1: cy + (dy * length) / 2,
  };
}
