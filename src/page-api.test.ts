import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "./core/themes.ts";
import { DEFAULT_BACKGROUND_ID } from "./export/background.ts";
import { DEFAULT_FRAME } from "./export/layout.ts";
import { resolveExport } from "./page-api.ts";
import { buildShareUrl, readSharedWorkspace } from "./share.ts";
import type { Workspace } from "./workspace.ts";

const code: Workspace = {
  document: [
    { type: "line", children: [{ text: "export function greet(name: string) {" }] },
    { type: "line", children: [{ text: "  return `Hello, ${name}`;" }] },
    { type: "line", children: [{ text: "}" }] },
  ],
  themeId: DEFAULT_THEME.id,
  backgroundId: DEFAULT_BACKGROUND_ID,
  frame: DEFAULT_FRAME,
  highlight: "auto",
};

const text = (workspace: Workspace) =>
  workspace.document.map((line) => line.children.map((leaf) => leaf.text).join("")).join("\n");

describe("resolveExport", () => {
  it("defaults to PNG and leaves the workspace alone", () => {
    const resolved = resolveExport(code);
    expect(resolved.format).toBe("png");
    expect(resolved.workspace).toBe(code);
  });

  it("names the accepted values when it refuses one", () => {
    expect(() => resolveExport(code, { format: "gif" })).toThrow(/expected one of png, svg, jpeg, webp/);
    expect(() => resolveExport(code, { language: "cobol" })).toThrow(/expected one of typescript, .*sql/);
  });

  it("colors the code the way the Syntax control does, and the link carries the colors", async () => {
    const { workspace } = resolveExport(code, { language: "typescript" });
    expect(text(workspace)).toBe(text(code));
    expect(workspace.highlight).toBe("typescript");
    expect(workspace.document.some((line) => line.children.some((leaf) => leaf.fg !== undefined))).toBe(true);

    // A link states its content as ANSI, so the colors have to be in it rather
    // than left to `syntax`, which re-colors nothing on open.
    const reopened = await readSharedWorkspace(await buildShareUrl(workspace, "https://boron.sh/"));
    expect(reopened?.document).toEqual(workspace.document);
    expect(reopened?.highlight).toBe("typescript");
  });
});
