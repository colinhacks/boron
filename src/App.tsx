import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEditor } from "slate";
import { withHistory } from "slate-history";
import { Slate, withReact } from "slate-react";
import { documentToRenderLines, type LineElement } from "./core/document.ts";
import { toAnsi, toChalkSource, toPlainText } from "./core/serialize.ts";
import { DEFAULT_THEME, themeById } from "./core/themes.ts";
import { TerminalSurface } from "./editor/TerminalEditor.tsx";
import { withTerminal } from "./editor/withTerminal.ts";
import {
  DEFAULT_BACKGROUND_ID,
  TRANSPARENT_ID,
  backgroundById,
  backgroundCss,
} from "./export/background.ts";
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
  FONT_SIZE,
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
import {
  sanitizeBackgroundId,
  sanitizeDocument,
  sanitizeFrame,
  sanitizeThemeId,
  type Workspace,
} from "./workspace.ts";

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

/**
 * What was saved last time, field by field. Anything missing or malformed is
 * dropped rather than defaulted here, so the caller can tell "never set" from
 * "set to the default" and fall through to the sample document.
 */
function loadPersisted(): Partial<Workspace> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const state = parsed as Partial<Workspace>;
    const document = sanitizeDocument(state.document);
    return {
      ...(document ? { document } : {}),
      ...(typeof state.themeId === "string" ? { themeId: sanitizeThemeId(state.themeId) } : {}),
      ...(typeof state.backgroundId === "string"
        ? { backgroundId: sanitizeBackgroundId(state.backgroundId) }
        : {}),
      ...(state.frame && typeof state.frame === "object" ? { frame: sanitizeFrame(state.frame) } : {}),
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
  const [backgroundId, setBackgroundId] = useState(() => persisted.backgroundId ?? DEFAULT_BACKGROUND_ID);
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
    const state: Workspace = { document: value, themeId, backgroundId, frame };
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

  /**
   * Swap the whole workspace out from under the editor. Slate takes its initial
   * value once and never again, so a new document has to be pushed onto the
   * editor by hand rather than re-rendered in.
   */
  const applyWorkspace = useCallback(
    (next: Workspace) => {
      editor.children = next.document;
      editor.selection = null;
      // The undo stack addresses paths in the document being replaced. Kept, it
      // either throws on the first Cmd+Z or — worse, when the old and new shapes
      // happen to line up — quietly rewrites the new document with the old one's
      // edits.
      editor.history = { undos: [], redos: [] };
      editor.onChange();
      setValue(next.document);
      setThemeId(next.themeId);
      setBackgroundId(next.backgroundId);
      setFrame(next.frame);
    },
    [editor],
  );

  /** Reset means everything — the document and every setting around it. */
  const resetAll = useCallback(() => {
    applyWorkspace({
      document: sampleDocument(),
      themeId: DEFAULT_THEME.id,
      backgroundId: DEFAULT_BACKGROUND_ID,
      frame: DEFAULT_FRAME,
    });
  }, [applyWorkspace]);


  // Dragging either edge of the block sets the minimum width. Captured on
  // pointerdown so the gesture survives the layout changing underneath it.
  const resizeRef = useRef<{ startX: number; startCols: number; side: "left" | "right"; floor: number; scale: number } | null>(null);
  // Which grip is held. Pointer capture keeps the events coming after the
  // pointer leaves the handle, but :hover does not survive the trip, so the lit
  // state is tracked rather than inferred.
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, side: "left" | "right") => {
      if (!layout) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(side);
      resizeRef.current = {
        startX: event.clientX,
        startCols: (layout.terminal.width - TERMINAL_PADDING * 2) / layout.charWidth,
        side,
        // Never narrower than the longest line — the block does not reflow.
        floor: Math.ceil(layout.widest / layout.charWidth),
        // Frozen for the gesture: widening the block can shrink the preview to
        // fit, and reading that live would make the drag accelerate under the
        // pointer.
        scale: previewScale,
      };
    },
    [layout, previewScale],
  );

  const moveResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = resizeRef.current;
      if (!drag || !layout) return;
      // The block stays centred, so an edge only travels half the width it adds.
      const dx = ((event.clientX - drag.startX) / drag.scale) * (drag.side === "right" ? 1 : -1);
      const next = Math.round(drag.startCols + (dx * 2) / layout.charWidth);
      setFrame((current) => ({ ...current, minColumns: Math.max(drag.floor, Math.min(200, next)) }));
    },
    [layout],
  );

  const endResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    setDragging(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

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
          <button type="button" className="button button--quiet" onClick={resetAll}>
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
                              fontSize: FONT_SIZE * CHROME_TITLE_SCALE,
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
                      fontSize={FONT_SIZE}
                      lineHeight={layout.lineHeight}
                      halfLeading={layout.halfLeading}
                      padding={TERMINAL_PADDING}
                      width={layout.terminal.width}
                    />
                  </div>

                  {(["left", "right"] as const).map((side) => (
                    <div
                      key={side}
                      className={`resize-handle${dragging === side ? " resize-handle--dragging" : ""}`}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Drag to set the minimum width"
                      style={{
                        left:
                          side === "left"
                            ? layout.terminal.x - 5
                            : layout.terminal.x + layout.terminal.width - 5,
                        top: layout.terminal.y,
                        height: layout.terminal.height,
                        // The grip counter-scales off this so it stays the same
                        // size on screen however far the preview is zoomed out.
                        "--preview-scale": previewScale,
                      } as React.CSSProperties}
                      onPointerDown={(event) => startResize(event, side)}
                      onPointerMove={moveResize}
                      onPointerUp={endResize}
                      onPointerCancel={endResize}
                    />
                  ))}
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
