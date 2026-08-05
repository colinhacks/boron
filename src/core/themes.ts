import { blend, relativeLuminance } from "./palette.ts";

export interface Theme {
  id: string;
  name: string;
  isLight: boolean;
  /** The terminal body background. */
  background: string;
  /** Default foreground — SGR 39, used verbatim for `plain` runs. */
  foreground: string;
  /** The sixteen ANSI colors, in chalk-name order. */
  ansi: readonly string[];
  /** Text selection highlight inside the editor. Chrome only, never exported. */
  selection: string;
}

interface ThemeSpec {
  id: string;
  name: string;
  background: string;
  foreground: string;
  ansi: readonly string[];
}

/**
 * A theme is a *palette*, nothing more — it decides what `red` looks like, the
 * way a terminal profile does. It deliberately has no say in which marks a run
 * carries, so the escape sequence a document serializes to is the same whatever
 * theme happens to be selected.
 */
function makeTheme(spec: ThemeSpec): Theme {
  const isLight = relativeLuminance(spec.background) > 0.4;
  return {
    id: spec.id,
    name: spec.name,
    isLight,
    background: spec.background,
    foreground: spec.foreground,
    ansi: spec.ansi,
    // Nearly the foreground, pulled just off it. This is painted translucent
    // (see `::selection` in `index.css`), and that alpha is spoken for — it is
    // what lets a selected run's fill read through — so all of the contrast has
    // to come from the colour. Blending most of the way to the background here
    // as well is what made a drag-select almost invisible.
    selection: blend(spec.foreground, spec.background, isLight ? 0.2 : 0.15),
  };
}

export const THEMES: readonly Theme[] = [
  makeTheme({
    id: "boron",
    name: "Boron",
    background: "#0f1117",
    foreground: "#b6c0cf",
    ansi: [
      "#1c1f2b", "#ff6b81", "#4ade80", "#fbbf24", "#60a5fa", "#c084fc", "#22d3ee", "#cbd5e1",
      "#4b5263", "#ff8797", "#86efac", "#fcd34d", "#93c5fd", "#d8b4fe", "#67e8f9", "#f1f5f9",
    ],
  }),
  makeTheme({
    id: "vscode",
    name: "VS Code Dark+",
    background: "#1e1e1e",
    foreground: "#cccccc",
    ansi: [
      "#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
      "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff",
    ],
  }),
  makeTheme({
    id: "dracula",
    name: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    ansi: [
      "#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
      "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff",
    ],
  }),
  makeTheme({
    id: "tokyo-night",
    name: "Tokyo Night",
    background: "#1a1b26",
    foreground: "#c0caf5",
    ansi: [
      "#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6",
      "#414868", "#ff7a93", "#b9f27c", "#ff9e64", "#7da6ff", "#bb9af7", "#0db9d7", "#c0caf5",
    ],
  }),
  makeTheme({
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    ansi: [
      "#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
      "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8",
    ],
  }),
  makeTheme({
    id: "nord",
    name: "Nord",
    background: "#2e3440",
    foreground: "#d8dee9",
    ansi: [
      "#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
      "#4c566a", "#d08770", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
    ],
  }),
  makeTheme({
    id: "one-dark",
    name: "One Dark",
    background: "#282c34",
    foreground: "#abb2bf",
    ansi: [
      "#3f4451", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
      "#5c6370", "#ef7178", "#a5d6a5", "#f0c674", "#74b2f2", "#d99ae8", "#66d1dc", "#ffffff",
    ],
  }),
  makeTheme({
    id: "solarized-dark",
    name: "Solarized Dark",
    background: "#002b36",
    foreground: "#93a1a1",
    ansi: [
      "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
      "#586e75", "#cb4b16", "#93a1a1", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
    ],
  }),
];

// Every shipped theme is currently a dark profile. `isLight` is kept — it is
// derived, and the light-background handling it drives stays correct — so a
// light theme is a palette away.
export const DEFAULT_THEME = THEMES[0]!;

export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? DEFAULT_THEME;
}
