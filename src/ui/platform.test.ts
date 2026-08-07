import { describe, expect, it } from "vitest";
import { altLabelFor } from "./platform.ts";

describe("altLabelFor", () => {
  it("names the Mac key on a Mac", () => {
    expect(altLabelFor("MacIntel")).toBe("⌥");
    expect(altLabelFor("macOS")).toBe("⌥");
  });

  /** `⌥` is not on a PC keyboard, so printing it there names a key nobody has. */
  it("names Alt everywhere else", () => {
    expect(altLabelFor("Win32")).toBe("Alt");
    expect(altLabelFor("Windows")).toBe("Alt");
    expect(altLabelFor("Linux x86_64")).toBe("Alt");
    expect(altLabelFor("iPhone")).toBe("Alt");
  });

  /**
   * The bug this function exists to keep fixed. Chrome hands back an empty
   * `userAgentData.platform` on macOS unless the hint is asked for, so the two
   * hints are joined rather than tried in order — a `??` here would take the
   * empty string as an answer and tell every Mac to press Alt.
   */
  it("still finds the Mac when the first hint is empty", () => {
    expect(altLabelFor("", "MacIntel")).toBe("⌥");
    expect(altLabelFor(undefined, "MacIntel")).toBe("⌥");
  });

  it("falls back to Alt when nothing identifies the platform", () => {
    expect(altLabelFor()).toBe("Alt");
    expect(altLabelFor("", undefined)).toBe("Alt");
  });
});
