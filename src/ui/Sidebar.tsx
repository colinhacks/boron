import type { ReactNode } from "react";
import { THEMES, type Theme } from "../core/themes.ts";
import {
  BACKGROUNDS,
  DEFAULT_BACKGROUND_ID,
  TRANSPARENT_ID,
  backgroundById,
  backgroundCss,
  isFillId,
  type Background,
} from "../export/background.ts";
import { themedBackground } from "../export/backdrop.ts";
import { MAX_COLUMNS, MAX_TITLE_LENGTH, MIN_COLUMNS, type FrameSettings } from "../export/layout.ts";

/**
 * The eyedropper that marks the one swatch you *pick* rather than choose.
 *
 * Without it the swatch is just a tenth colour in a grid of nine, and a hue
 * wheel is not self-explanatory — it reads as one more backdrop that happens to
 * be rainbow-coloured. The glyph is the part that says "this one opens a picker".
 *
 * White with a dark halo, rather than a colour picked to suit the swatch: it has
 * to stay legible on the wheel *and* on whatever the reader goes on to choose,
 * which includes both `#ffff00` and `#000000`. The halo is a stroke drawn under
 * the fill (`paint-order` in the stylesheet), so it shows only outside the shape
 * and never thickens it.
 */
function Dropper() {
  return (
    <svg className="background-swatch__dropper" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      {/* Bulb and barrel, on the diagonal, then the shaft down to the tip. */}
      <path d="M20.5 3.5a2.6 2.6 0 0 0-3.7 0l-2.4 2.4-1-1-2.2 2.2 6.7 6.7 2.2-2.2-1-1 2.4-2.4a2.6 2.6 0 0 0 0-3.7z" />
      <path d="M11.1 9.9 4 17l-1 4 4-1 7.1-7.1z" />
    </svg>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {hint ? <span className="field__hint">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step = 1, suffix = "px", onChange }: SliderProps) {
  return (
    <Field label={label} hint={`${value}${suffix}`}>
      <input
        type="range"
        name={label.toLowerCase().replace(/\s+/g, "-")}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <span className="switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch__track" aria-hidden="true" />
      <span className="switch__thumb" aria-hidden="true" />
    </span>
  );
}

export interface SidebarProps {
  theme: Theme;
  onThemeChange: (id: string) => void;
  background: Background | null;
  onBackgroundChange: (id: string) => void;
  frame: FrameSettings;
  onFrameChange: (patch: Partial<FrameSettings>) => void;
}

export function Sidebar({
  theme,
  onThemeChange,
  background,
  onBackgroundChange,
  frame,
  onFrameChange,
}: SidebarProps) {
  const fill = background && isFillId(background.id) ? background.id : null;
  // What the colour input opens on: whatever is behind the block right now, so
  // the picker starts from the current backdrop rather than from a colour
  // nobody asked for. Transparent has nothing behind it to start from, so it
  // borrows the default backdrop's first stop — themed, and in the family.
  const seed =
    background?.stops[0] ??
    themedBackground(backgroundById(DEFAULT_BACKGROUND_ID), theme)?.stops[0] ??
    "#000000";

  return (
    <aside className="sidebar">
      <section className="panel">
        <h2 className="panel__title">Theme</h2>
        <div className="theme-grid">
          {THEMES.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`theme-card${candidate.id === theme.id ? " theme-card--active" : ""}`}
              onClick={() => onThemeChange(candidate.id)}
              style={{ background: candidate.background }}
            >
              <span className="theme-card__dots">
                {[1, 2, 3, 4, 6].map((index) => (
                  <i key={index} style={{ background: candidate.ansi[index] }} />
                ))}
              </span>
              <span className="theme-card__name" style={{ color: candidate.foreground }}>
                {candidate.name}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel__title">Backdrop</h2>
        <div className="background-grid">
          {BACKGROUNDS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              title={candidate.name}
              aria-label={candidate.name}
              aria-pressed={background?.id === candidate.id}
              className={`background-swatch${background?.id === candidate.id ? " background-swatch--active" : ""}`}
              // Shown as it will actually render behind the current theme —
              // a swatch of the authored stops would promise the wrong picture.
              style={{ background: backgroundCss(themedBackground(candidate, theme)) }}
              onClick={() => onBackgroundChange(candidate.id)}
            />
          ))}
          <button
            type="button"
            title="Transparent"
            aria-label="Transparent"
            aria-pressed={background === null}
            className={`background-swatch background-swatch--none${background === null ? " background-swatch--active" : ""}`}
            onClick={() => onBackgroundChange(TRANSPARENT_ID)}
          />
          {/*
            A flat colour, picked rather than chosen from the set. The control is
            the platform's own colour input, hidden behind a swatch that looks
            like the eight beside it — a colour picker is one of the few widgets
            every OS already has a good one of, and it comes with eyedropper,
            recent colours and keyboard support for free.
          */}
          <label
            title={fill ? `Fill ${fill}` : "Fill colour"}
            className={`background-swatch background-swatch--fill${fill ? " background-swatch--active" : ""}`}
            // Unpicked it stays the hue wheel the stylesheet gives it, which is
            // what says "any colour" rather than naming one.
            style={fill ? { background: fill } : undefined}
          >
            <Dropper />
            <input
              type="color"
              className="background-swatch__picker"
              aria-label="Fill colour"
              value={fill ?? seed}
              // Clicking a swatch selects it, and this one is a swatch. The
              // input alone would not do that: it fires nothing until the colour
              // actually *changes*, so clicking the wheel and picking the shade
              // it already shows would open a dialog and select nothing.
              onClick={() => onBackgroundChange(fill ?? seed)}
              onChange={(event) => onBackgroundChange(event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">Title bar</h2>
          <Switch
            label="Title bar"
            checked={frame.showChrome}
            onChange={(showChrome) => onFrameChange({ showChrome })}
          />
        </div>
        {frame.showChrome ? (
          // No label — the panel heading and the toggle beside it already say
          // what this is, and the box only exists while the title bar is on.
          <input
            type="text"
            name="window-title"
            className="text-input"
            aria-label="Title"
            // Matches the clamp in `sanitizeFrame`. Without it the clamp fires
            // on a real title, and the block a link opens is narrower than the
            // one that was shared — the chrome widens to fit the title.
            maxLength={MAX_TITLE_LENGTH}
            value={frame.title}
            placeholder="zsh — boron"
            onChange={(event) => onFrameChange({ title: event.target.value })}
          />
        ) : null}
      </section>

      <section className="panel">
        <h2 className="panel__title">Window</h2>
        <Slider
          label="Corner radius"
          value={frame.radius}
          min={0}
          max={28}
          onChange={(radius) => onFrameChange({ radius })}
        />
        <Slider
          label="Shadow"
          value={frame.shadowStrength}
          min={0}
          max={100}
          suffix="%"
          onChange={(shadowStrength) => onFrameChange({ shadowStrength })}
        />
        <Slider
          label="Padding"
          value={frame.framePadding}
          min={0}
          max={140}
          onChange={(framePadding) => onFrameChange({ framePadding })}
        />
        <Slider
          label="Width"
          value={frame.columns}
          min={MIN_COLUMNS}
          max={MAX_COLUMNS}
          suffix=" cols"
          onChange={(columns) => onFrameChange({ columns })}
        />
      </section>

    </aside>
  );
}
