import type { ReactNode } from "react";
import {
  HIGHLIGHT_LANGUAGES,
  languageLabel,
  type HighlightChoice,
  type LanguageId,
} from "../core/highlight.ts";
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
import {
  ASPECT_PRESETS,
  MAX_COLUMNS,
  MAX_TITLE_LENGTH,
  MIN_COLUMNS,
  aspectById,
  type FrameSettings,
} from "../export/layout.ts";

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

function Field({
  label,
  hint,
  locked,
  children,
}: {
  label: string;
  hint?: string;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={`field${locked ? " field--locked" : ""}`}>
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
  /** Why the control is off, shown in place of the value. Absent means it is on. */
  lockedHint?: string | undefined;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step = 1, suffix = "px", lockedHint, onChange }: SliderProps) {
  return (
    // The hint says why rather than blanking to a dash: a dimmed control that
    // does not account for itself reads as broken rather than as switched off.
    <Field label={label} hint={lockedHint ?? `${value}${suffix}`} locked={lockedHint !== undefined}>
      <input
        type="range"
        name={label.toLowerCase().replace(/\s+/g, "-")}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={lockedHint !== undefined}
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
  highlight: HighlightChoice;
  /** What the last paste was detected as, named on the auto option. */
  detectedLanguage: LanguageId | null;
  onHighlightChange: (choice: HighlightChoice) => void;
}

export function Sidebar({
  theme,
  onThemeChange,
  background,
  onBackgroundChange,
  frame,
  onFrameChange,
  highlight,
  detectedLanguage,
  onHighlightChange,
}: SidebarProps) {
  const aspect = aspectById(frame.aspect);
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

      {/*
        Next to the theme, because the two answer the same question from
        different ends: the theme decides what `green` looks like, and this
        decides which words are green in the first place.
      */}
      <section className="panel">
        <h2 className="panel__title">Syntax</h2>
        <select
          className="text-input select-input"
          aria-label="Syntax highlighting"
          value={highlight}
          onChange={(event) => onHighlightChange(event.target.value as HighlightChoice)}
        >
          <option value="auto">
            {detectedLanguage ? `Auto-detect (${languageLabel(detectedLanguage)})` : "Auto-detect"}
          </option>
          {/*
            Named for what it *is* rather than for what it turns off. This is
            what a paste carrying escape codes selects, and those colours have
            an author — calling the option "None" would invite someone to read
            it as "no colours" and clear a picture they were handed.
          */}
          <option value="ansi">Custom (ANSI)</option>
          <optgroup label="Language">
            {HIGHLIGHT_LANGUAGES.map((language) => (
              <option key={language.id} value={language.id}>
                {language.label}
              </option>
            ))}
          </optgroup>
        </select>
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

      {/*
        No heading. Each control below names itself in the same small caps a
        panel title uses, so "Window" would only have been a second label over
        five labels — and the sliders are legible in a way that a group needs a
        name to be: nobody reads "Padding" and wonders what it is padding.
      */}
      <section className="panel">
        {/*
          First, because it is the one control here that decides what the others
          can still do: everything below sizes a block, and this decides whether
          the image is sized by that block or fixed from the outside.
        */}
        <Field label="Aspect ratio" hint={aspect ? `${aspect.width} × ${aspect.height}` : "fits the content"}>
          <div className="aspect-row">
            {[null, ...ASPECT_PRESETS].map((candidate) => (
              <button
                key={candidate?.id ?? "free"}
                type="button"
                // The ring, not the accent: this is a set you pick one of, like
                // a theme or a backdrop, and the accent means action here.
                className={`aspect-chip${candidate?.id === frame.aspect ? " aspect-chip--active" : ""}`}
                aria-pressed={candidate?.id === frame.aspect}
                onClick={() => onFrameChange({ aspect: candidate?.id ?? null })}
              >
                {candidate?.label ?? "Free"}
              </button>
            ))}
          </div>
        </Field>
        <Slider
          label="Width"
          value={frame.columns}
          min={MIN_COLUMNS}
          max={MAX_COLUMNS}
          suffix=" cols"
          onChange={(columns) => onFrameChange({ columns })}
        />
        <Slider
          label="Corner radius"
          value={frame.radius}
          min={0}
          max={28}
          onChange={(radius) => onFrameChange({ radius })}
        />
        <Slider
          label="Padding"
          value={frame.framePadding}
          min={0}
          max={140}
          // A fixed canvas leaves whatever it leaves around the block, so there
          // is nothing here to set. Width stays live and does the job people
          // reach for this slider to do: fewer columns is a bigger block.
          lockedHint={aspect ? "set by the aspect" : undefined}
          onChange={(framePadding) => onFrameChange({ framePadding })}
        />
        <Slider
          label="Shadow"
          value={frame.shadowStrength}
          min={0}
          max={100}
          suffix="%"
          onChange={(shadowStrength) => onFrameChange({ shadowStrength })}
        />
      </section>

    </aside>
  );
}
