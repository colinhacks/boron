import { createContext, useContext, type ReactNode } from "react";
import type { EditorView } from "prosemirror-view";

interface EditorContextValue {
  view: EditorView | null;
  /**
   * Bumped on every transaction. ProseMirror's state lives outside React, so
   * this is what tells the toolbars that the selection or the marks under it may
   * have moved — `useSlate` used to do the same job implicitly.
   */
  version: number;
}

const EditorContext = createContext<EditorContextValue>({ view: null, version: 0 });

export function EditorProvider({ value, children }: { value: EditorContextValue; children: ReactNode }) {
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditorView(): EditorContextValue {
  return useContext(EditorContext);
}
