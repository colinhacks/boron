import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GHOSTTY_1_3_1, GHOSTTY_1_3_1_PLAIN } from "../core/clipboard-fixtures.ts";
import { emptyDocument, lineText, type TerminalDocument } from "../core/document.ts";
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
});
