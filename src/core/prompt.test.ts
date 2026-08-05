import { describe, expect, it } from "vitest";
import { classifyDocument, hasCommands, matchPrompt } from "./prompt.ts";

describe("matchPrompt", () => {
  it("matches a bare dollar prompt", () => {
    expect(matchPrompt("$ npm install")).toBe(2);
  });

  it("matches a lone marker at end of line", () => {
    expect(matchPrompt("$")).toBe(1);
  });

  it("matches the modern arrow prompt", () => {
    expect(matchPrompt("❯ bun run dev")).toBe(2);
  });

  it("keeps a shell's context prefix as part of the prompt", () => {
    expect(matchPrompt("colin@mac:~/code$ ls -la")).toBe(18);
    expect(matchPrompt("~/code ❯ ls")).toBe(9);
    expect(matchPrompt("~ $ ls")).toBe(4);
  });

  it("tolerates leading indentation", () => {
    expect(matchPrompt("  $ ls")).toBe(4);
  });

  it("matches oh-my-zsh's arrow at the start of a line", () => {
    expect(matchPrompt("➜  ~ cd Documents")).toBe(3);
    expect(matchPrompt("➜  fray git:(main) ✗ nub test")).toBe(3);
    expect(matchPrompt("➜")).toBe(1);
  });

  it("rejects an indented arrow, which is CLI output rather than a prompt", () => {
    // vite, pnpm and friends bullet their output with the same character.
    expect(matchPrompt("  ➜  Local:   http://127.0.0.1:4919/")).toBe(-1);
    expect(matchPrompt("    ➜ done")).toBe(-1);
  });

  it("rejects an arrow that is not a bare marker", () => {
    expect(matchPrompt("➜➜ x")).toBe(-1);
    expect(matchPrompt("build ➜ dist")).toBe(-1);
  });

  it("rejects shell variables and substitutions", () => {
    expect(matchPrompt("$HOME/bin")).toBe(-1);
    expect(matchPrompt("$(date) is now")).toBe(-1);
    expect(matchPrompt("${FOO} bar")).toBe(-1);
    expect(matchPrompt("PATH=$HOME/bin npm start")).toBe(-1);
  });

  it("rejects a dollar sign that is not the prompt", () => {
    expect(matchPrompt("cost is 5$ each")).toBe(-1);
    expect(matchPrompt("echo done $")).toBe(-1);
  });

  it("matches a bare chevron at the start of a line", () => {
    expect(matchPrompt("> npm install")).toBe(2);
    expect(matchPrompt(">")).toBe(1);
  });

  it("rejects a chevron that is indented or not bare", () => {
    // The bullets docker, npm and esbuild print, which a laxer rule would eat.
    expect(matchPrompt("-> installed 4 packages")).toBe(-1);
    expect(matchPrompt("=> Done in 1.2s")).toBe(-1);
    expect(matchPrompt("  => [internal] load build definition")).toBe(-1);
    expect(matchPrompt("  > indented")).toBe(-1);
    expect(matchPrompt("cat foo > bar.txt")).toBe(-1);
    expect(matchPrompt("if x > 3 then")).toBe(-1);
  });

  it("rejects markers this heuristic deliberately excludes", () => {
    expect(matchPrompt("# a comment")).toBe(-1);
    expect(matchPrompt("50% complete")).toBe(-1);
  });

  it("rejects ordinary output", () => {
    expect(matchPrompt("added 143 packages in 2s")).toBe(-1);
    expect(matchPrompt("")).toBe(-1);
  });
});

describe("classifyDocument", () => {
  it("marks commands and output", () => {
    expect(classifyDocument(["$ ls", "a.txt", "b.txt"])).toEqual([
      { kind: "command", commandStart: 2 },
      { kind: "output", commandStart: 0 },
      { kind: "output", commandStart: 0 },
    ]);
  });

  it("continues a command across a trailing backslash", () => {
    expect(classifyDocument(["$ curl example.com \\", "  --header 'x: 1' \\", "  --silent", "done"])).toEqual([
      { kind: "command", commandStart: 2 },
      { kind: "command", commandStart: 0 },
      { kind: "command", commandStart: 0 },
      { kind: "output", commandStart: 0 },
    ]);
  });

  it("reports whether the document has any commands at all", () => {
    expect(hasCommands(classifyDocument(["just some text", "more text"]))).toBe(false);
    expect(hasCommands(classifyDocument(["$ ls"]))).toBe(true);
  });
});
