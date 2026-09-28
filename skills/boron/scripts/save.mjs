#!/usr/bin/env node
/**
 * Opens a boron.sh link in a headless Chromium-based browser and saves the
 * exported image.
 *
 *   node save.mjs "<link>" ./out.png [--format png|svg|jpeg|webp] [--language typescript]
 *
 * Prints the saved path, then a link to the picture as exported.
 *
 * No npm dependencies: it starts the Chrome, Chromium, Edge or Brave already on
 * the machine and talks to it over the DevTools protocol with Node's built-in
 * WebSocket (Node 22+). Set CHROME_PATH to pick a browser explicitly.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    format: { type: "string", default: "png" },
    language: { type: "string" },
  },
});
const [url, out] = positionals;
if (!url || !out) {
  console.error("Usage: node save.mjs <link> <output file> [--format png|svg|jpeg|webp] [--language id]");
  process.exit(1);
}
if (typeof WebSocket === "undefined") {
  console.error("save.mjs needs Node 22 or newer (for the built-in WebSocket)");
  process.exit(1);
}

const TIMEOUT_MS = 60_000;

const CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
  ],
  win32: [
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
};

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = (CANDIDATES[process.platform] ?? []).find((path) => existsSync(path));
  if (!found) {
    console.error("No Chrome, Chromium, Edge or Brave found. Set CHROME_PATH to a Chromium-based browser.");
    process.exit(1);
  }
  return found;
}

/** Resolves to the port once the browser prints its DevTools address to stderr. */
function devToolsPort(browser) {
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Browser did not start:\n${log}`)), TIMEOUT_MS);
    browser.stderr.on("data", (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    browser.on("exit", (code) => reject(new Error(`Browser exited with code ${code}:\n${log}`)));
  });
}

/** A minimal DevTools protocol client: numbered requests, plus waiting for one event. */
async function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else {
      listeners.get(message.method)?.(message.params);
    }
  });

  return {
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    once(method) {
      return new Promise((resolve) => listeners.set(method, resolve));
    },
    close() {
      socket.close();
    },
  };
}

const capture = readFileSync(new URL("./capture.js", import.meta.url), "utf8");
/** A fresh profile, so no workspace stored by an earlier visit can leak in. */
const profile = mkdtempSync(join(tmpdir(), "boron-"));
const browser = spawn(
  findBrowser(),
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1400,900",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

let client;
try {
  const port = await devToolsPort(browser);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  client = await connect(page.webSocketDebuggerUrl);

  await client.send("Page.enable");
  const loaded = client.once("Page.loadEventFired");
  await client.send("Page.navigate", { url });
  await loaded;

  const options = JSON.stringify({ format: values.format, language: values.language });
  const { result, exceptionDetails } = await client.send("Runtime.evaluate", {
    expression: `(${capture})(${options})`,
    awaitPromise: true,
    returnByValue: true,
    timeout: TIMEOUT_MS,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  }

  const { dataUrl, link } = result.value;
  writeFileSync(out, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  console.log(out);
  console.log(link);
} catch (error) {
  console.error(`save.mjs: ${error.message}`);
  process.exitCode = 1;
} finally {
  client?.close();
  if (browser.exitCode === null && browser.signalCode === null) {
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await exited;
  }
  rmSync(profile, { recursive: true, force: true });
}
