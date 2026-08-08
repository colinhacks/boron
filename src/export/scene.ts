import { dimmedForeground } from "../core/style.ts";
import type { Theme } from "../core/themes.ts";
import type { Background } from "./background.ts";
import type { FrameSettings, Layout } from "./layout.ts";

export interface Scene {
  layout: Layout;
  frame: FrameSettings;
  theme: Theme;
  background: Background | null;
}

/** Shadow geometry at full strength, shared so every renderer casts the same one. */
export const SHADOW = {
  offsetY: 18,
  stdDeviation: 20,
  opacity: 0.45,
} as const;

/**
 * Scale that geometry by a 0-100 strength, or `null` for no shadow at all.
 *
 * Offset, blur and opacity all scale together — dropping opacity alone would
 * leave a wide grey haze at low settings, where what you want is a shadow that
 * tightens as it fades. Zero returns `null` so the editor, the canvas and the
 * SVG all take the same "draw nothing" branch rather than each deciding.
 *
 * `contentScale` is the block's own scale on a fixed canvas, and it multiplies
 * the geometry but not the opacity — a shadow that kept its absolute blur under
 * an enlarged block would read as a tighter shadow on a bigger window. It is
 * applied here rather than by the renderers because a canvas shadow is exempt
 * from the current transform while an SVG `feDropShadow` is not, so a transform
 * would give the two exporters different pictures.
 */
export function resolveShadow(
  strength: number,
  contentScale = 1,
): { offsetY: number; stdDeviation: number; opacity: number } | null {
  const t = Math.min(100, Math.max(0, strength)) / 100;
  if (t === 0) return null;
  return {
    offsetY: SHADOW.offsetY * t * contentScale,
    stdDeviation: SHADOW.stdDeviation * t * contentScale,
    opacity: SHADOW.opacity * t,
  };
}

export const CHROME_TITLE_SCALE = 0.85;

export function chromeBorderColor(theme: Theme): string {
  return theme.isLight ? "rgba(0, 0, 0, 0.09)" : "rgba(255, 255, 255, 0.07)";
}

export function chromeTitleColor(theme: Theme): string {
  return dimmedForeground(theme);
}
