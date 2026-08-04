import { useEffect, useId, useRef, useState } from "react";

export interface SplitOption {
  id: string;
  label: string;
}

interface SplitButtonProps {
  /** What the body reads right now — the chosen option, not the menu's name. */
  label: string;
  options: readonly SplitOption[];
  value: string;
  /** Names the menu for screen readers, e.g. "Choose a copy format". */
  menuLabel: string;
  onSelect: (id: string) => void;
  onAction: () => void;
  disabled?: boolean;
  primary?: boolean;
}

/**
 * A button with a menu hung off its right edge.
 *
 * Picking from the menu only *changes* what the button does — it never fires the
 * action. That split is the whole point: choosing a format is cheap and
 * reversible, while writing a file or the clipboard is not, so they get separate
 * clicks rather than one that does both.
 */
export function SplitButton({
  label,
  options,
  value,
  menuLabel,
  onSelect,
  onAction,
  disabled,
  primary,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".split-button__toggle")?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Opening with the keyboard should land you on the current choice, not nowhere.
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>, step: number) => {
    event.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(".split-menu__item") ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + step + items.length) % items.length]!.focus();
  };

  return (
    <div className={`split-button${primary ? " split-button--primary" : ""}`} ref={root}>
      <button type="button" className="split-button__action" onClick={onAction} disabled={disabled}>
        {label}
      </button>
      <button
        type="button"
        className="split-button__toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={menuLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="9" height="6" viewBox="0 0 9 6" aria-hidden="true">
          <path d="M1 1.5 4.5 5 8 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div
          className="split-menu"
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") moveFocus(event, 1);
            else if (event.key === "ArrowUp") moveFocus(event, -1);
          }}
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === value}
              className={`split-menu__item${option.id === value ? " split-menu__item--active" : ""}`}
              onClick={() => {
                onSelect(option.id);
                setOpen(false);
              }}
            >
              <span className="split-menu__tick" aria-hidden="true">
                {option.id === value ? "✓" : ""}
              </span>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
