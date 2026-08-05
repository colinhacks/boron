import type { ReactNode } from "react";
import { THEMES, type Theme } from "../core/themes.ts";
import { BACKGROUNDS, TRANSPARENT_ID, backgroundCss, type Background } from "../export/background.ts";
import type { FrameSettings } from "../export/layout.ts";

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
              style={{ background: backgroundCss(candidate) }}
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
          <Field label="Title">
            <input
              type="text"
              name="window-title"
              className="text-input"
              value={frame.title}
              placeholder="zsh — boron"
              onChange={(event) => onFrameChange({ title: event.target.value })}
            />
          </Field>
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
          label="Minimum width"
          value={frame.minColumns}
          min={20}
          max={120}
          suffix=" cols"
          onChange={(minColumns) => onFrameChange({ minColumns })}
        />
      </section>

    </aside>
  );
}
