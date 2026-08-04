import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEditor } from "slate";
import { withHistory } from "slate-history";
import { Slate, withReact } from "slate-react";
import { documentToRenderLines, type LineElement, type TerminalDocument } from "./core/document.ts";
import { toAnsi, toChalkSource, toPlainText } from "./core/serialize.ts";
import { DEFAULT_THEME, themeById } from "./core/themes.ts";
import { TerminalSurface } from "./editor/TerminalEditor.tsx";
import { withTerminal } from "./editor/withTerminal.ts";
import { TRANSPARENT_ID, backgroundById, backgroundCss } from "./export/background.ts";
import { FONT_FAMILY, ensureFontsLoaded } from "./export/fonts.ts";
import {
  IMAGE_FORMATS,
  copyImageToClipboard,
  copyText,
  downloadBlob,
  renderBlob,
  type ImageFormat,
} from "./export/index.ts";
import { DEFAULT_FRAME, computeLayout, trafficLights, type FrameSettings } from "./export/layout.ts";
import { CHROME_TITLE_SCALE, SHADOW, chromeBorderColor, chromeTitleColor } from "./export/scene.ts";
import { Sidebar } from "./ui/Sidebar.tsx";
import { Toolbar } from "./ui/Toolbar.tsx";
import { sampleDocument } from "./ui/sample.ts";

const STORAGE_KEY = "boron.workspace.v1";

interface PersistedState {
  document: TerminalDocument;
  themeId: string;
  backgroundId: string;
  frame: FrameSettings;
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const state = parsed as Partial<PersistedState>;
    const documentIsValid =
      Array.isArray(state.document) &&
      state.document.length > 0 &&
      state.document.every((line) => line?.type === "line" && Array.isArray(line.children));
    return {
      ...(documentIsValid ? { document: state.document } : {}),
      ...(typeof state.themeId === "string" ? { themeId: state.themeId } : {}),
      ...(typeof state.backgroundId === "string" ? { backgroundId: state.backgroundId } : {}),
      ...(state.frame && typeof state.frame === "object" ? { frame: { ...DEFAULT_FRAME, ...state.frame } } : {}),
    };
  } catch {
    return {};
  }
}

const SCALES = [1, 2, 3] as const;

export function App() {
  const persisted = useMemo(loadPersisted, []);
  const [value, setValue] = useState<LineElement[]>(() => persisted.document ?? sampleDocument());
  const [themeId, setThemeId] = useState(() => persisted.themeId ?? DEFAULT_THEME.id);
  const [backgroundId, setBackgroundId] = useState(() => persisted.backgroundId ?? "midnight");
  const [frame, setFrame] = useState<FrameSettings>(() => persisted.frame ?? DEFAULT_FRAME);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [scale, setScale] = useState<number>(2);
  const [fontsReady, setFontsReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState(1);

  const theme = useMemo(() => themeById(themeId), [themeId]);
  const background = useMemo(() => backgroundById(backgroundId), [backgroundId]);

  const themeRef = useRef(theme);
  themeRef.current = theme;

  const editor = useMemo(
    () => withTerminal(withHistory(withReact(createEditor())), () => themeRef.current.ansi),
    [],
  );

  const initialValue = useRef(value).current;

  useEffect(() => {
    let cancelled = false;
    ensureFontsLoaded().then(
      () => {
        if (!cancelled) setFontsReady(true);
      },
      () => {
        // Fall back to the system monospace rather than blocking the editor.
        if (!cancelled) setFontsReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const state: PersistedState = { document: value, themeId, backgroundId, frame };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Quota or private mode — persistence is a convenience, not a requirement.
    }
  }, [value, themeId, backgroundId, frame]);

  const renderLines = useMemo(() => documentToRenderLines(value), [value]);
  const layout = useMemo(
    () => (fontsReady ? computeLayout(renderLines, theme, frame) : null),
    [fontsReady, renderLines, theme, frame],
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = stageRef.current;
    if (!element || !layout) return;
    const fit = () => {
      const available = element.clientWidth - 48;
      setPreviewScale(Math.min(1, available / layout.width));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout]);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 1800);
  }, []);

  const handleChange = useCallback(
    (next: unknown) => {
      const changedContent = editor.operations.some((operation) => operation.type !== "set_selection");
      if (changedContent) setValue(next as LineElement[]);
    },
    [editor],
  );

  const handleFrameChange = useCallback((patch: Partial<FrameSettings>) => {
    setFrame((current) => ({ ...current, ...patch }));
  }, []);

  const scene = layout ? { layout, frame, theme, background } : null;

  const handleDownload = useCallback(async () => {
    if (!scene) return;
    const spec = IMAGE_FORMATS.find((candidate) => candidate.id === format)!;
    try {
      const blob = await renderBlob(scene, format, scale);
      downloadBlob(blob, `boron.${spec.extension}`);
      flash(`Saved boron.${spec.extension}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Export failed");
    }
  }, [scene, format, scale, flash]);

  const handleCopyImage = useCallback(async () => {
    if (!scene) return;
    try {
      await copyImageToClipboard(scene, scale);
      flash("Image copied");
    } catch {
      flash("Clipboard blocked — use Save instead");
    }
  }, [scene, scale, flash]);

  const copyAs = useCallback(
    async (kind: "ansi" | "text" | "chalk") => {
      const serialized =
        kind === "ansi"
          ? toAnsi(renderLines, theme)
          : kind === "text"
            ? toPlainText(renderLines)
            : toChalkSource(renderLines, theme);
      try {
        await copyText(serialized);
        flash(kind === "ansi" ? "ANSI copied" : kind === "text" ? "Text copied" : "chalk source copied");
      } catch {
        flash("Clipboard blocked");
      }
    },
    [renderLines, theme, flash],
  );

  const resetDocument = useCallback(() => {
    const next = sampleDocument();
    editor.children = next;
    editor.selection = null;
    editor.onChange();
    setValue(next);
  }, [editor]);

  const lights = layout ? trafficLights(layout, frame) : [];

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ▚
          </span>
          <span className="brand__name">Boron</span>
          <span className="brand__tagline">terminal blocks, worth screenshotting</span>
        </div>

        <div className="export-bar">
          <div className="segmented" role="group" aria-label="Image format">
            {IMAGE_FORMATS.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={`segmented__item${format === candidate.id ? " segmented__item--active" : ""}`}
                aria-pressed={format === candidate.id}
                onClick={() => setFormat(candidate.id)}
              >
                {candidate.label}
              </button>
            ))}
          </div>

          <div className={`segmented${format === "svg" ? " segmented--disabled" : ""}`} role="group" aria-label="Scale">
            {SCALES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                disabled={format === "svg"}
                className={`segmented__item${scale === candidate ? " segmented__item--active" : ""}`}
                aria-pressed={scale === candidate}
                onClick={() => setScale(candidate)}
              >
                {candidate}×
              </button>
            ))}
          </div>

          <button type="button" className="button" onClick={handleCopyImage} disabled={!scene}>
            Copy image
          </button>
          <button type="button" className="button button--primary" onClick={handleDownload} disabled={!scene}>
            Save {format.toUpperCase()}
          </button>
        </div>
      </header>

      <Slate editor={editor} initialValue={initialValue} onChange={handleChange}>
        <main className="app-main">
          <div className="workspace">
            <Toolbar theme={theme} />

            <div className="stage" ref={stageRef}>
              {layout ? (
                <div
                  className="frame-fit"
                  style={{ width: layout.width * previewScale, height: layout.height * previewScale }}
                >
                <div
                  className="frame"
                  style={{
                    width: layout.width,
                    height: layout.height,
                    background: backgroundCss(background),
                    transform: `scale(${previewScale})`,
                  }}
                >
                  <div
                    className="terminal"
                    style={{
                      left: frame.framePadding,
                      top: frame.framePadding,
                      width: layout.terminal.width,
                      height: layout.terminal.height,
                      borderRadius: frame.radius,
                      background: theme.background,
                      boxShadow: frame.shadow
                        ? `0 ${SHADOW.offsetY}px ${SHADOW.stdDeviation * 2}px rgba(0, 0, 0, ${SHADOW.opacity})`
                        : "none",
                    }}
                  >
                    {frame.showChrome ? (
                      <div
                        className="terminal__chrome"
                        style={{ height: layout.chromeHeight, borderBottomColor: chromeBorderColor(theme) }}
                      >
                        {lights.map((light, index) => (
                          <i
                            key={index}
                            className="terminal__light"
                            style={{
                              left: light.cx - layout.terminal.x - light.r,
                              top: light.cy - layout.terminal.y - light.r,
                              width: light.r * 2,
                              height: light.r * 2,
                              background: light.fill,
                            }}
                          />
                        ))}
                        {frame.title ? (
                          <span
                            className="terminal__title"
                            style={{
                              color: chromeTitleColor(theme),
                              fontFamily: FONT_FAMILY,
                              fontSize: frame.fontSize * CHROME_TITLE_SCALE,
                            }}
                          >
                            {frame.title}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <TerminalSurface
                      editor={editor}
                      theme={theme}
                      fontSize={frame.fontSize}
                      lineHeight={layout.lineHeight}
                      halfLeading={layout.halfLeading}
                      padding={frame.terminalPadding}
                      width={layout.terminal.width}
                    />
                  </div>
                </div>
                </div>
              ) : (
                <p className="stage__loading">Loading font…</p>
              )}
            </div>

            <div className="stage-footer">
              <p className="hint">
                Lines starting with <code>$</code> or <code>❯</code> render as commands; everything else dims as
                output. Paste real terminal output — ANSI escapes and rich text keep their colors.
              </p>
              <div className="stage-footer__actions">
                <button type="button" className="chip" onClick={() => copyAs("ansi")}>
                  Copy ANSI
                </button>
                <button type="button" className="chip" onClick={() => copyAs("chalk")}>
                  Copy chalk
                </button>
                <button type="button" className="chip" onClick={() => copyAs("text")}>
                  Copy text
                </button>
                <button type="button" className="chip chip--ghost" onClick={resetDocument}>
                  Reset
                </button>
              </div>
            </div>
          </div>

          <Sidebar
            theme={theme}
            onThemeChange={setThemeId}
            background={background}
            onBackgroundChange={(id) => setBackgroundId(id === TRANSPARENT_ID ? TRANSPARENT_ID : id)}
            frame={frame}
            onFrameChange={handleFrameChange}
          />
        </main>
      </Slate>

      <div className={`toast${toast ? " toast--visible" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
