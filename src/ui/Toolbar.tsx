import { useSlate } from "slate-react";
import { colorToCss } from "../core/style.ts";
import type { Theme } from "../core/themes.ts";
import { MODIFIER_KEYS, NAMED_COLORS, type Color, type ModifierKey, type NamedColor } from "../core/types.ts";
import { activeMarks, clearFormatting, setForeground, toggleModifier } from "../editor/marks.ts";

/**
 * Every control is a real chalk capability with a real SGR code. Three of the
 * six are not honoured everywhere, though, and a tool for designing terminal
 * output should say so rather than let you find out later — `caveat` is
 * surfaced both in the tooltip and as a mark on the chip.
 */
const MODIFIERS: Record<ModifierKey, { label: string; sgr: number; caveat?: string }> = {
  bold: { label: "Bold", sgr: 1 },
  dim: { label: "Dim", sgr: 2, caveat: "widely supported; some terminals render it as a lighter font weight" },
  italic: { label: "Italic", sgr: 3, caveat: "not widely supported; some terminals show inverse or blink instead" },
  underline: { label: "Underline", sgr: 4 },
  strikethrough: { label: "Strike", sgr: 9, caveat: "not supported in macOS Terminal.app" },
  inverse: { label: "Inverse", sgr: 7 },
};

const COLOR_LABELS: Record<NamedColor, string> = {
  black: "Black",
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
  magenta: "Magenta",
  cyan: "Cyan",
  white: "White",
  blackBright: "Bright black (gray)",
  redBright: "Bright red",
  greenBright: "Bright green",
  yellowBright: "Bright yellow",
  blueBright: "Bright blue",
  magentaBright: "Bright magenta",
  cyanBright: "Bright cyan",
  whiteBright: "Bright white",
};

/** The SGR parameter a named foreground serializes to, for the tooltip. */
function sgrFor(index: number): number {
  return index < 8 ? 30 + index : 90 + (index - 8);
}

interface SwatchRowProps {
  active: Color | undefined;
  theme: Theme;
  onPick: (color: Color | null) => void;
}

function SwatchRow({ active, theme, onPick }: SwatchRowProps) {
  return (
    <div className="swatch-row">
      <span className="swatch-row__label">Text</span>
      <div className="swatch-row__grid">
        {NAMED_COLORS.map((name, index) => (
          <button
            key={name}
            type="button"
            className={`swatch${active === name ? " swatch--active" : ""}`}
            style={{ background: colorToCss(name, theme) }}
            title={`${COLOR_LABELS[name]} — chalk.${name} · SGR ${sgrFor(index)}`}
            aria-label={`Text: ${COLOR_LABELS[name]}`}
            aria-pressed={active === name}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(name)}
          />
        ))}
        <button
          type="button"
          className={`swatch swatch--clear${active === undefined ? " swatch--active" : ""}`}
          title="Default text color — SGR 39"
          aria-label="Default text color"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(null)}
        >
          ⁄
        </button>
      </div>
    </div>
  );
}

export function Toolbar({ theme }: { theme: Theme }) {
  const editor = useSlate();
  const marks = activeMarks(editor);

  return (
    <div className="toolbar" role="toolbar" aria-label="Text formatting">
      <SwatchRow active={marks.fg} theme={theme} onPick={(color) => setForeground(editor, color)} />
      <div className="swatch-row">
        <span className="swatch-row__label">Style</span>
        <div className="modifier-group">
          {MODIFIER_KEYS.map((key) => {
            const modifier = MODIFIERS[key];
            return (
              <button
                key={key}
                type="button"
                className={`chip${marks[key] === true ? " chip--active" : ""} chip--${key}`}
                title={`chalk.${key} · SGR ${modifier.sgr}${modifier.caveat ? ` — ${modifier.caveat}` : ""}`}
                aria-pressed={marks[key] === true}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleModifier(editor, key)}
              >
                {modifier.label}
                {modifier.caveat ? (
                  <span className="chip__caveat" aria-hidden="true">
                    °
                  </span>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            className="chip chip--ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => clearFormatting(editor)}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
