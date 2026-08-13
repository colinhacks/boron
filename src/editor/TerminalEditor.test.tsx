import { Slice } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GHOSTTY_1_3_1, GHOSTTY_1_3_1_PLAIN } from "../core/clipboard-fixtures.ts";
import { MAX_LINES, emptyDocument, lineText, sanitizeDocument, type TerminalDocument } from "../core/document.ts";
import { DEFAULT_THEME } from "../core/themes.ts";
import { TerminalSurface, type TerminalHandle } from "./TerminalEditor.tsx";

/**
 * The editor mounted for real, because what these pin is the *wiring*.
 *
 * `parseClipboard` has its own tests and passed them throughout the stretch
 * where pasting a terminal into the app was broken end to end: the plugin
 * carrying it was written, exported, and never added to the editor's plugin
 * list. Nothing short of a paste reaching the real view would have said so.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(): { handle: TerminalHandle; document: () => TerminalDocument } {
  host = window.document.createElement("div");
  window.document.body.appendChild(host);

  const ref: { current: TerminalHandle | null } = { current: null };
  let latest: TerminalDocument = emptyDocument();

  act(() => {
    root = createRoot(host!);
    root.render(
      <TerminalSurface
        initialDocument={emptyDocument()}
        lines={emptyDocument()}
        theme={DEFAULT_THEME}
        ansi16={() => DEFAULT_THEME.ansi}
        fontSize={14}
        lineHeight={21}
        halfLeading={3}
        padding={24}
        width={800}
        wrapWidth={800}
        columns={80}
        onChange={(next) => {
          latest = next;
        }}
        handle={ref}
      />,
    );
  });

  return { handle: ref.current!, document: () => latest };
}

/** A paste event carrying exactly the flavours named. jsdom has no `ClipboardEvent`. */
function pasteEvent(flavours: Record<string, string>): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => flavours[type] ?? "", types: Object.keys(flavours) },
  });
  return event;
}

/**
 * A drop of the same. jsdom has no `DragEvent` either, and no layout — so
 * `posAtCoords` is stubbed to the end of the document, which is where a drop onto
 * an empty block lands anyway.
 */
function dropEvent(view: EditorView, flavours: Record<string, string>): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { getData: (type: string) => flavours[type] ?? "", types: Object.keys(flavours), files: [] },
  });
  Object.defineProperty(event, "clientX", { value: 0 });
  Object.defineProperty(event, "clientY", { value: 0 });
  view.posAtCoords = () => ({ pos: view.state.doc.content.size, inside: -1 });
  return event;
}

describe("pasting into the editor", () => {
  it("reads a terminal's rich text as rows and runs rather than as markup", () => {
    const { handle, document } = mount();
    const view = handle.view()!;

    act(() => {
      view.dom.dispatchEvent(pasteEvent({ "text/html": GHOSTTY_1_3_1, "text/plain": GHOSTTY_1_3_1_PLAIN }));
    });

    // Ghostty writes every styled run as its own `<div>`, so markup ProseMirror
    // parsed itself arrives as one line per colour change instead.
    expect(document().map(lineText)).toEqual(GHOSTTY_1_3_1_PLAIN.split("\n"));

    const fray = document()[0]!.children.find((child) => child.text === "FRAY");
    expect(fray).toEqual({ text: "FRAY", fg: "#b294bb", bold: true });
  });

  it("keeps the colors a copy out of Boron itself carries", () => {
    const { handle, document } = mount();
    const view = handle.view()!;

    // ProseMirror's own flavour, which it reads back through the schema. The
    // terminal parser must stand aside for it: re-deriving `green` from the
    // rendered hex would freeze one theme's idea of it.
    act(() => {
      view.dom.dispatchEvent(
        pasteEvent({
          "text/html":
            '<div data-pm-slice="1 1 []"><div class="terminal-line">' +
            '<span class="sgr-fg" data-color="green">ok</span></div></div>',
          "text/plain": "ok",
        }),
      );
    });

    expect(document().map(lineText)).toEqual(["ok"]);
    expect(document()[0]!.children).toEqual([{ text: "ok", fg: "green" }]);
  });

  it("stops at the line ceiling rather than saving a document that will not load", () => {
    // `sanitizeDocument` refuses more than MAX_LINES, and it is the reader on the
    // load path — so a paste past the ceiling is not a big document, it is a
    // document thrown away whole the next time the app opens.
    const { handle, document } = mount();
    const view = handle.view()!;
    const huge = Array.from({ length: MAX_LINES + 500 }, (_, i) => `line ${i}`).join("\n");

    act(() => {
      view.dom.dispatchEvent(pasteEvent({ "text/plain": huge }));
    });

    expect(document().length).toBe(MAX_LINES);
    expect(sanitizeDocument(document())).not.toBeNull();
  });
});

describe("dropping into the editor", () => {
  it("reads dropped terminal output through the same parsers a paste uses", () => {
    // ProseMirror never consults `handlePaste` for a drop, so without its own
    // prop the flavour priority is skipped and Ghostty's per-run `<div>`s arrive
    // as one line each.
    const { handle, document } = mount();
    const view = handle.view()!;

    act(() => {
      view.dom.dispatchEvent(dropEvent(view, { "text/html": GHOSTTY_1_3_1, "text/plain": GHOSTTY_1_3_1_PLAIN }));
    });

    const lines = document().map(lineText);
    expect(lines).toContain("FRAY v0.1.5  ready in 2.9s");
    expect(lines).toContain("256color truecolor trailing-plain");
    const fray = document().flatMap((line) => line.children).find((child) => child.text === "FRAY");
    expect(fray).toEqual({ text: "FRAY", fg: "#b294bb", bold: true });
  });

  it("leaves a drag that started inside the editor to ProseMirror", () => {
    // An internal drag carries a schema-validated slice and its own move
    // semantics; re-deriving it from rendered colours would lose the difference
    // between `green` and one theme's idea of green.
    const { handle, document } = mount();
    const view = handle.view()!;
    view.dragging = { slice: Slice.empty, move: false };

    act(() => {
      view.dom.dispatchEvent(dropEvent(view, { "text/plain": "dropped" }));
    });

    // ProseMirror moves its own empty slice and nothing else. Had the terminal
    // parsers run, the `text/plain` riding along on the event would be in there.
    expect(document().map(lineText).join("\n")).not.toContain("dropped");
    view.dragging = null;
  });
});
