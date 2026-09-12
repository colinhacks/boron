import { describe, expect, it } from "vitest";
import { altLabelFor, urlWriteIntervalFor } from "./platform.ts";

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

const SAFARI_18 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";
const SAFARI_16 =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("urlWriteIntervalFor", () => {
  it("lets Blink and Gecko write at the rate they will actually take", () => {
    expect(urlWriteIntervalFor(false, CHROME)).toBe(50);
    expect(urlWriteIntervalFor(false, "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe(50);
  });

  it("slows down for WebKit, which throws rather than ignoring the call", () => {
    expect(urlWriteIntervalFor(true, SAFARI_18)).toBe(120);
    expect(urlWriteIntervalFor(true, SAFARI_16)).toBe(320);
  });

  /**
   * Guessing high is the failure that throws, so anything unreadable is treated
   * as the oldest thing it could be.
   */
  it("assumes the strictest limit when it cannot read a version", () => {
    expect(urlWriteIntervalFor(true, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(320);
    expect(urlWriteIntervalFor(true, "")).toBe(320);
  });

  /**
   * Chrome on iOS is WebKit underneath — it has `GestureEvent` and is bound by
   * the same limit — but the `Version/` it reports is the OS, not Safari's. The
   * sniff has to lead with the capability for that reason, and the UA only
   * refines it.
   */
  it("does not trust a UA string alone", () => {
    expect(urlWriteIntervalFor(false, SAFARI_18)).toBe(50);
    expect(urlWriteIntervalFor(true, "Mozilla/5.0 (iPhone) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1")).toBe(320);
  });
});
