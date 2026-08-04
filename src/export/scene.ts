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

/** Shared shadow geometry so the canvas and SVG renderers cast the same one. */
export const SHADOW = {
  offsetY: 18,
  stdDeviation: 20,
  opacity: 0.45,
} as const;

export const CHROME_TITLE_SCALE = 0.85;

export function chromeBorderColor(theme: Theme): string {
  return theme.isLight ? "rgba(0, 0, 0, 0.09)" : "rgba(255, 255, 255, 0.07)";
}

export function chromeTitleColor(theme: Theme): string {
  return dimmedForeground(theme);
}
