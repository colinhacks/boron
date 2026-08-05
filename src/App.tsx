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
import {
  DEFAULT_FRAME,
  TERMINAL_PADDING,
  computeLayout,
  trafficLights,
  type FrameSettings,
} from "./export/layout.ts";
import { CHROME_TITLE_SCALE, chromeBorderColor, chromeTitleColor, resolveShadow } from "./export/scene.ts";
import { Credit } from "./ui/Credit.tsx";
import { Logo } from "./ui/Logo.tsx";
import { Sidebar } from "./ui/Sidebar.tsx";
import { SplitButton } from "./ui/SplitButton.tsx";
import { FloatingToolbar } from "./ui/FloatingToolbar.tsx";
import { sampleDocument } from "./ui/sample.ts";

/**
 * Bump this when a default changes that everyone should actually get.
 *
 * The whole workspace is persisted, so a new default — a new sample document, a
 * wider minimum — never reaches anyone who has opened the app before: their
 * stored copy wins forever. Changing the key retires the old state and lets the
 * new defaults through. It discards what was saved under the previous key, which
 * is the intent.
 */
const STORAGE_KEY = "boron.workspace.v2";

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

type CopyMode = "image" | "ansi" | "chalk" | "text";

const COPY_MODES: readonly { id: CopyMode; label: string }[] = [
  { id: "image", label: "image" },
  { id: "ansi", label: "ANSI" },
  { id: "chalk", label: "chalk" },
  { id: "text", label: "text" },
];

export function App() {
  const persisted = useMemo(loadPersisted, []);
  const [value, setValue] = useState<LineElement[]>(() => persisted.document ?? sampleDocument());
  const [themeId, setThemeId] = useState(() => persisted.themeId ?? DEFAULT_THEME.id);
  const [backgroundId, setBackgroundId] = useState(() => persisted.backgroundId ?? "midnight");
  const [frame, setFrame] = useState<FrameSettings>(() => persisted.frame ?? DEFAULT_FRAME);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [copyMode, setCopyMode] = useState<CopyMode>("image");
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
      const blob = await renderBlob(scene, format);
      // The domain rides along in the filename, so a shared export still says
      // where it was made once it is out of the page.
      const filename = `boron.sh.${spec.extension}`;
      downloadBlob(blob, filename);
      flash(`Saved ${filename}`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Export failed");
    }
  }, [scene, format, flash]);

  const handleCopyImage = useCallback(async () => {
    if (!scene) return;
    try {
      await copyImageToClipboard(scene);
      flash("Image copied");
    } catch {
      flash("Clipboard blocked — use Save instead");
    }
  }, [scene, flash]);

  const copyAs = useCallback(
    async (kind: "ansi" | "text" | "chalk") => {
      const serialized =
        kind === "ansi"
          ? toAnsi(renderLines)
          : kind === "text"
            ? toPlainText(renderLines)
            : toChalkSource(renderLines);
      try {
        await copyText(serialized);
        flash(kind === "ansi" ? "ANSI copied" : kind === "text" ? "Text copied" : "chalk source copied");
      } catch {
        flash("Clipboard blocked");
      }
    },
    [renderLines, flash],
  );

  const handleCopy = useCallback(async () => {
    if (copyMode === "image") await handleCopyImage();
    else await copyAs(copyMode);
  }, [copyMode, handleCopyImage, copyAs]);

  const resetDocument = useCallback(() => {
    const next = sampleDocument();
    editor.children = next;
    editor.selection = null;
    editor.onChange();
    setValue(next);
  }, [editor]);

  const lights = layout ? trafficLights(layout, frame) : [];
  const shadow = resolveShadow(frame.shadowStrength);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark">
            <Logo />
          </span>
          <span className="brand__name">Boron</span>
          {/* Set in the terminal face, like the OG card and the block itself —
              a tagline about terminal output should look like terminal output. */}
          <span className="brand__tagline" style={{ fontFamily: FONT_FAMILY }}>
            gorgeous editable terminal screenshots
          </span>
        </div>

        <div className="export-bar">
          <button type="button" className="button button--quiet" onClick={resetDocument}>
            Reset
          </button>

          <SplitButton
            label={`Copy ${COPY_MODES.find((candidate) => candidate.id === copyMode)!.label}`}
            options={COPY_MODES.map((candidate) => ({ id: candidate.id, label: `Copy as ${candidate.label}` }))}
            value={copyMode}
            menuLabel="Choose what to copy"
            onSelect={(id) => setCopyMode(id as CopyMode)}
            onAction={handleCopy}
            disabled={copyMode === "image" && !scene}
          />

          <SplitButton
            primary
            label={`Save ${IMAGE_FORMATS.find((candidate) => candidate.id === format)!.label}`}
            options={IMAGE_FORMATS.map((candidate) => ({ id: candidate.id, label: `Save as ${candidate.label}` }))}
            value={format}
            menuLabel="Choose an image format"
            onSelect={(id) => setFormat(id as ImageFormat)}
            onAction={handleDownload}
            disabled={!scene}
          />
        </div>
      </header>

      <Slate editor={editor} initialValue={initialValue} onChange={handleChange}>
        <main className="app-main">
          <div className="workspace">
            <FloatingToolbar theme={theme} />

            <div className="stage" ref={stageRef}>
              {layout ? (
                <>
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
                      boxShadow: shadow
                        ? `0 ${shadow.offsetY}px ${shadow.stdDeviation * 2}px rgba(0, 0, 0, ${shadow.opacity})`
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
                      padding={TERMINAL_PADDING}
                      width={layout.terminal.width}
                    />
                  </div>
                </div>
                </div>
                <p className="stage__caption">Edit above or try copy/pasting from your terminal.</p>
                </>
              ) : (
                <p className="stage__loading">Loading font…</p>
              )}
            </div>

            <Credit />
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
