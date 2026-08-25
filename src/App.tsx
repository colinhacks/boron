import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { documentToRenderLines, type LineElement } from "./core/document.ts";
import { toAnsi, toChalkSource, toPlainText } from "./core/serialize.ts";
import { DEFAULT_THEME, themeById } from "./core/themes.ts";
import { BoxSelectionProvider } from "./editor/BoxSelection.tsx";
import { EditorProvider } from "./editor/context.tsx";
import { TerminalSurface, type TerminalHandle } from "./editor/TerminalEditor.tsx";
import { ALT_LABEL } from "./ui/platform.ts";
import {
  DEFAULT_BACKGROUND_ID,
  backgroundById,
  backgroundCss,
} from "./export/background.ts";
import { themedBackground } from "./export/backdrop.ts";
import { FONT_FAMILY, ensureFontsLoaded, hasIconGlyphs } from "./export/fonts.ts";
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
  MAX_COLUMNS,
  MIN_COLUMNS,
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
import { buildShareUrl, consumeSharedWorkspace } from "./share.ts";
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
 * different width — never reaches anyone who has opened the app before: their
 * stored copy wins forever. Changing the key retires the old state and lets the
 * new defaults through. It discards what was saved under the previous key, which
 * is the intent.
 */
const STORAGE_KEY = "boron.workspace.v3";

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

/**
 * How far the preview may zoom out to fit the stage. A document can run to
 * `MAX_LINES`, and fitting five thousand rows into a viewport would leave a
 * sliver nobody can read and nothing can be typed into — past this point the
 * block is better scrolled than shrunk. The floor is where the type stops being
 * legible, in pixels of rendered type.
 *
 * Against `layout.fontSize` rather than `FONT_SIZE`, because those two stopped
 * being the same number once a fixed canvas could scale the block: a card that
 * enlarged the type would otherwise stop zooming out while the glyphs were still
 * three times this tall.
 */
const MIN_LEGIBLE_TYPE = 6;

/**
 * The how-to legend under the block — the gestures you would not guess.
 *
 * Only those. "Edit above, or paste from your terminal" used to lead it and is
 * gone: a text box you can click into does not need a caption saying so, and a
 * legend whose first line states the obvious teaches the reader to skip the one
 * that does not.
 *
 * "Select a column" is gone with it, for being untrue rather than merely
 * obvious. The gesture draws a *rectangle* — any rows, any span of cells within
 * them (see `BoxSelection`) — and "column" promises a whole vertical strip you
 * cannot actually ask for.
 *
 * A list rather than a sentence: these are unrelated gestures, and stringing
 * them together with "or" reads as one choice between several. It is the shape
 * that grows, too — the next trick worth telling anyone about is another entry
 * here, not a longer sentence.
 */
const LEGEND: readonly { id: string; text: ReactNode }[] = [
  {
    id: "box-select",
    text: (
      <>
        Hold <kbd>{ALT_LABEL}</kbd> and drag to select a rectangle
      </>
    ),
  },
];

type CopyMode = "image" | "link" | "ansi" | "chalk" | "text";

const COPY_MODES: readonly { id: CopyMode; label: string }[] = [
  { id: "ansi", label: "ANSI" },
  { id: "image", label: "image" },
  { id: "link", label: "link" },
  { id: "chalk", label: "chalk" },
  { id: "text", label: "text" },
];

export interface AppProps {
  /**
   * The workspace this page was opened with, when the URL carried one. It wins
   * outright over what is in `localStorage` — a shared link has to look the same
   * to whoever opens it, and half of the sender's settings crossed with half of
   * the reader's is nobody's picture.
   */
  shared?: Workspace | null;
}

export function App({ shared }: AppProps = {}) {
  const persisted = useMemo(() => (shared ? {} : loadPersisted()), [shared]);
  const [value, setValue] = useState<LineElement[]>(() => shared?.document ?? persisted.document ?? sampleDocument());
  const [themeId, setThemeId] = useState(() => shared?.themeId ?? persisted.themeId ?? DEFAULT_THEME.id);
  const [backgroundId, setBackgroundId] = useState(() => shared?.backgroundId ?? persisted.backgroundId ?? DEFAULT_BACKGROUND_ID);
  const [frame, setFrame] = useState<FrameSettings>(() => shared?.frame ?? persisted.frame ?? DEFAULT_FRAME);
  const [format, setFormat] = useState<ImageFormat>("png");
  const [copyMode, setCopyMode] = useState<CopyMode>("ansi");
  const [fontsReady, setFontsReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [previewScale, setPreviewScale] = useState(1);

  const theme = useMemo(() => themeById(themeId), [themeId]);
  // Adapted here rather than at each place it is drawn, so the preview, the
  // canvas exporter and the SVG exporter all get the themed stops without
  // knowing that backdrops adapt at all.
  const background = useMemo(
    () => themedBackground(backgroundById(backgroundId), theme),
    [backgroundId, theme],
  );

  const themeRef = useRef(theme);
  themeRef.current = theme;
  // The paste parsers map a terminal's colours onto the active palette, so they
  // read the theme at paste time rather than capturing it.
  const ansi16 = useCallback(() => themeRef.current.ansi, []);

  const surface = useRef<TerminalHandle>(null);
  const initialDocument = useRef(value).current;
  // ProseMirror's state is outside React; this is what re-renders the toolbars
  // when the selection moves.
  const [editorVersion, noteEditorChange] = useReducer((count: number) => count + 1, 0);

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

  // The icon face is 880 KB against 203 KB for all four text faces, and most
  // terminal screenshots contain no icon at all — so it is fetched the moment a
  // paste or a keystroke puts a Nerd Font glyph in the document, and not before.
  // The title counts: the chrome bar is drawn in the same font.
  const needsIcons = useMemo(
    () => hasIconGlyphs(frame.title) || value.some((line) => line.children.some((leaf) => hasIconGlyphs(leaf.text))),
    [value, frame.title],
  );

  useEffect(() => {
    if (!needsIcons) return;
    // Nothing to cancel: the face is cached by URL, so a document that loses its
    // last icon and gets it back does not fetch twice.
    void ensureFontsLoaded({ icons: true });
  }, [needsIcons]);

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

  // Fit both axes, not just the width. A block taller than the stage used to
  // just overflow it, and a centred flex item overflows at *both* ends — so its
  // first rows sat above the scroll origin, where no scroll position can reach
  // them. Paste enough and the top of the terminal disappeared under the header
  // for good.
  const fitRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = fitRef.current;
    if (!element || !layout) return;
    // The box is the space the block may occupy, so its own client size is the
    // budget — no subtracting the stage's padding or the legend back out.
    const fit = () => {
      const scale = Math.min(1, element.clientWidth / layout.width, element.clientHeight / layout.height);
      setPreviewScale(Math.max(MIN_LEGIBLE_TYPE / layout.fontSize, scale));
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

  // Only fires when the document actually changed — a bare selection move does
  // not reach here.
  const handleChange = useCallback((next: LineElement[]) => setValue(next), []);

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

  /**
   * A link that reopens this exact picture. Everything the render depends on
   * rides in the URL, so what comes up on the other side is the same image
   * rather than the same document under the reader's own settings.
   */
  const handleCopyLink = useCallback(async () => {
    try {
      await copyText(await buildShareUrl({ document: value, themeId, backgroundId, frame }, window.location.href));
      flash("Link copied");
    } catch {
      flash("Clipboard blocked");
    }
  }, [value, themeId, backgroundId, frame, flash]);

  const handleCopy = useCallback(async () => {
    if (copyMode === "image") await handleCopyImage();
    else if (copyMode === "link") await handleCopyLink();
    else await copyAs(copyMode);
  }, [copyMode, handleCopyImage, handleCopyLink, copyAs]);

  /** Swap the whole workspace out from under the editor. */
  const applyWorkspace = useCallback((next: Workspace) => {
    surface.current?.replaceDocument(next.document);
    setThemeId(next.themeId);
    setBackgroundId(next.backgroundId);
    setFrame(next.frame);
  }, []);

  /** Reset means everything — the document and every setting around it. */
  const resetAll = useCallback(() => {
    applyWorkspace({
      document: sampleDocument(),
      themeId: DEFAULT_THEME.id,
      backgroundId: DEFAULT_BACKGROUND_ID,
      frame: DEFAULT_FRAME,
    });
  }, [applyWorkspace]);

  /**
   * A share link pasted into a tab already on Boron changes only the fragment,
   * and a browser does not reload for that — so the handoff in `main.tsx` never
   * runs and the link would appear to do nothing at all.
   */
  useEffect(() => {
    const onHashChange = () => {
      void consumeSharedWorkspace().then((next) => {
        if (!next) return;
        applyWorkspace(next);
        flash("Opened a shared link");
      });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [applyWorkspace, flash]);


  // Dragging either edge of the block sets how many columns wide the terminal
  // is, and the text reflows to it. Captured on pointerdown so the gesture
  // survives the layout changing underneath it.
  const resizeRef = useRef<{ startX: number; startCols: number; side: "left" | "right"; scale: number } | null>(null);
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
        // The setting itself, not the measured block: a long title can hold the
        // block wider than the columns it is showing, and a drag that started
        // from the width would jump the moment it took over.
        startCols: frame.columns,
        side,
        // Frozen for the gesture: widening the block can shrink the preview to
        // fit, and reading that live would make the drag accelerate under the
        // pointer.
        scale: previewScale,
      };
    },
    [layout, frame.columns, previewScale],
  );

  const moveResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = resizeRef.current;
      if (!drag || !layout) return;
      // The block stays centred, so an edge only travels half the width it adds.
      const dx = ((event.clientX - drag.startX) / drag.scale) * (drag.side === "right" ? 1 : -1);
      const next = Math.round(drag.startCols + (dx * 2) / layout.charWidth);
      setFrame((current) => ({ ...current, columns: Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, next)) }));
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
  const shadow = resolveShadow(frame.shadowStrength, layout?.contentScale ?? 1);

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

      {/* The box reads the view for its geometry, so the editor context wraps it. */}
      <EditorProvider value={{ view: surface.current?.view() ?? null, version: editorVersion }}>
        <BoxSelectionProvider
          lines={value}
          columns={frame.columns}
          charWidth={layout?.charWidth ?? 0}
          lineHeight={layout?.lineHeight ?? 0}
        >
        <main className="app-main">
          <div className="workspace">
            <FloatingToolbar theme={theme} />

            <div className="stage">
              <div className="stage__fit" ref={fitRef}>
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
                      // From the layout rather than from `framePadding`, which
                      // stopped being where the block sits the moment a fixed
                      // canvas could centre it.
                      left: layout.terminal.x,
                      top: layout.terminal.y,
                      width: layout.terminal.width,
                      height: layout.terminal.height,
                      borderRadius: frame.radius * layout.contentScale,
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
                              fontSize: layout.fontSize * CHROME_TITLE_SCALE,
                            }}
                          >
                            {frame.title}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <TerminalSurface
                      handle={surface}
                      initialDocument={initialDocument}
                      lines={value}
                      columns={frame.columns}
                      ansi16={ansi16}
                      onChange={handleChange}
                      onSelectionChange={noteEditorChange}
                      theme={theme}
                      fontSize={layout.fontSize}
                      lineHeight={layout.lineHeight}
                      halfLeading={layout.halfLeading}
                      padding={layout.terminalPadding}
                      width={layout.terminal.width}
                      wrapWidth={layout.wrapWidth}
                    />
                  </div>

                  {(["left", "right"] as const).map((side) => (
                    <div
                      key={side}
                      className={`resize-handle${dragging === side ? " resize-handle--dragging" : ""}`}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Drag to set the width in columns"
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
                {/* Hung off the block's own box so it sits under the block
                    wherever that ends up, rather than at the foot of a stage
                    that is as tall as the window. It is positioned out of flow,
                    which is what keeps it off the measurement above. */}
                <ul className="stage__legend">
                  {LEGEND.map(({ id, text }) => (
                    <li key={id}>{text}</li>
                  ))}
                </ul>
                </div>
              ) : (
                <p className="stage__loading">Loading font…</p>
              )}
              </div>
            </div>

            <Credit />
          </div>

          <Sidebar
            theme={theme}
            onThemeChange={setThemeId}
            background={background}
            // Every kind of backdrop is a string id and always was — a name, the
            // transparent one, and now a `#rrggbb` fill. The ternary that used
            // to sit here returned its own argument on both branches.
            onBackgroundChange={setBackgroundId}
            frame={frame}
            onFrameChange={handleFrameChange}
          />
        </main>
        </BoxSelectionProvider>
      </EditorProvider>

      <div className={`toast${toast ? " toast--visible" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
