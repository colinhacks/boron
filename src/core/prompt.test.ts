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

  it("rejects markers this heuristic deliberately excludes", () => {
    expect(matchPrompt("# a comment")).toBe(-1);
    expect(matchPrompt("> quoted output")).toBe(-1);
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
