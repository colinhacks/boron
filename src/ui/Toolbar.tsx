import { useSlate } from "slate-react";
import { colorToCss } from "../core/style.ts";
import type { Theme } from "../core/themes.ts";
import { MODIFIER_KEYS, NAMED_COLORS, type Color, type ModifierKey, type NamedColor } from "../core/types.ts";
import { activeMarks, clearFormatting, setColor, toggleModifier } from "../editor/marks.ts";

/**
 * Every control is exactly one SGR code — that correspondence is the only
 * criterion for being here, and the tooltip names the code.
 */
const MODIFIERS: Record<ModifierKey, { label: string; sgr: number }> = {
  bold: { label: "Bold", sgr: 1 },
  dim: { label: "Dim", sgr: 2 },
  italic: { label: "Italic", sgr: 3 },
  underline: { label: "Underline", sgr: 4 },
  strikethrough: { label: "Strike", sgr: 9 },
  inverse: { label: "Inverse", sgr: 7 },
  hidden: { label: "Hidden", sgr: 8 },
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

/** The SGR parameter a named color serializes to, for the tooltip. */
function sgrFor(index: number, background: boolean): number {
  const base = background ? 40 : 30;
  return index < 8 ? base + index : base + 60 + (index - 8);
}

interface SwatchRowProps {
  label: string;
  markKey: "fg" | "bg";
  active: Color | undefined;
  theme: Theme;
  onPick: (color: Color | null) => void;
}

function SwatchRow({ label, markKey, active, theme, onPick }: SwatchRowProps) {
  const background = markKey === "bg";
  return (
    <div className="swatch-row">
      <span className="swatch-row__label">{label}</span>
      <div className="swatch-row__grid">
        {NAMED_COLORS.map((name, index) => {
          const chalkName = background ? `bg${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;
          return (
            <button
              key={name}
              type="button"
              className={`swatch${active === name ? " swatch--active" : ""}`}
              style={{ background: colorToCss(name, theme) }}
              title={`${COLOR_LABELS[name]} — chalk.${chalkName} · SGR ${sgrFor(index, background)}`}
              aria-label={`${label}: ${COLOR_LABELS[name]}`}
              aria-pressed={active === name}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(name)}
            />
          );
        })}
        <button
          type="button"
          className={`swatch swatch--clear${active === undefined ? " swatch--active" : ""}`}
          title={`Default ${label.toLowerCase()} — SGR ${background ? 49 : 39}`}
          aria-label={`Default ${label.toLowerCase()}`}
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
      <SwatchRow
        label="Text"
        markKey="fg"
        active={marks.fg}
        theme={theme}
        onPick={(color) => setColor(editor, "fg", color)}
      />
      <SwatchRow
        label="Fill"
        markKey="bg"
        active={marks.bg}
        theme={theme}
        onPick={(color) => setColor(editor, "bg", color)}
      />
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
                title={`chalk.${key} · SGR ${modifier.sgr}`}
                aria-pressed={marks[key] === true}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleModifier(editor, key)}
              >
                {modifier.label}
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
