#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const outputDir = "docs/articles/assets";
const host = "127.0.0.1";
const explorerPort = Number(process.env.GS_EXPLORER_SCREENSHOT_PORT || await freePort());
const explorerBaseUrl = `http://${host}:${explorerPort}`;
const libraryPort = Number(process.env.GS_LIBRARY_SCREENSHOT_PORT || await freePort());
const libraryBaseUrl = `http://${host}:${libraryPort}`;
const liveActions = process.env.GS_RUN_LIVE === "1" || process.env.GS_SCREENSHOT_RUN_ACTIONS === "1";
const libraryScreenshotsEnabled = process.env.GS_SCREENSHOT_LIBRARY !== "0" && hasLibraryCredentials();

mkdirSync(outputDir, { recursive: true });

const explorer = startExplorer(explorerPort);
let library;
let browser;

try {
  await waitForExplorer(explorerBaseUrl, explorer);

  const playwright = await import(resolvePlaywright());
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  if (!chromium) {
    throw new Error("Playwright chromium launcher was not found. Install playwright or provide /Users/tariq/node_modules/playwright.");
  }

  browser = await chromium.launch({ headless: true });

  for (const shot of screenshots()) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await captureExplorerScreenshot(page, shot);
    await context.close();
  }

  await stopExplorer(explorer);

  if (libraryScreenshotsEnabled) {
    library = startLibrary(libraryPort);
    await waitForLibrary(libraryBaseUrl, library);
    for (const shot of libraryScreenshots()) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await captureLibraryScreenshot(page, shot);
      await context.close();
    }
  } else {
    console.log("Skipping Library Books screenshots: set GS_USERNAME/GS_PASSWORD or GS_USER/GS_PASS to capture the live example.");
  }
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (library) await stopExplorer(library);
  await stopExplorer(explorer);
}

async function captureExplorerScreenshot(page, shot) {
  await openExplorer(page, shot.window);
  await shot.prepare(page);
  await settle(page);
  const path = join(outputDir, shot.file);
  await page.screenshot({ path, fullPage: false });
  console.log(`Wrote ${path}`);
}

async function captureLibraryScreenshot(page, shot) {
  await openLibrary(page);
  await shot.prepare(page);
  await settle(page);
  const path = join(outputDir, shot.file);
  await page.screenshot({ path, fullPage: false });
  console.log(`Wrote ${path}`);
}

async function openExplorer(page, windowName) {
  await page.goto(explorerBaseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.removeItem("gemstone-js-explorer-layout-v2");
    localStorage.removeItem("gemstone-js-class-browser-auto-commit-v1");
  });
  await page.goto(`${explorerBaseUrl}/?window=${encodeURIComponent(windowName)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#desktop", { timeout: 10_000 });
  await waitForTaskbar(page);
}

async function openLibrary(page) {
  await page.goto(libraryBaseUrl, { waitUntil: "domcontentloaded" });
  await waitForLibraryBooks(page);
}

async function waitForTaskbar(page) {
  await page.waitForFunction(() => {
    const taskbar = document.querySelector("#taskbar");
    return taskbar && taskbar.textContent && taskbar.textContent.trim().length > 0;
  }, { timeout: 10_000 }).catch(() => undefined);
}

async function prepareWorkspace(page) {
  await focusWindow(page, "workspace");
  await closeWindows(page, ["inspect", "globals", "roots", "classes", "symbols", "codegen", "statusLog"]);
  await page.locator("#evalSource").fill("System stoneName");
  await page.locator("#evalReturn").selectOption("value").catch(() => undefined);
  if (liveActions) {
    await page.locator("#evalRun").click();
    await waitForText(page, "#evalOutput", 5_000);
  }
}

async function prepareClassBrowser(page) {
  await focusWindow(page, "classes");
  await closeWindows(page, ["inspect", "globals", "roots", "symbols", "workspace", "codegen", "statusLog", "debugger", "classPreview"]);
  await page.locator("#className").fill("Object").catch(() => undefined);
  await waitForText(page, "#classSourceOutput", liveActions ? 10_000 : 2_000);
}

async function prepareDebugger(page) {
  await focusWindow(page, "debugger");
  await closeWindows(page, ["inspect", "globals", "roots", "symbols", "workspace", "classes", "codegen", "statusLog", "classPreview"]);
  await page.locator("#debugSource").fill("1/0");
  await page.locator("#debugReturn").selectOption("inspect").catch(() => undefined);
  await page.locator("#debugRun").click();
  await Promise.race([
    waitForText(page, "#debugSummaryOutput", 10_000),
    waitForText(page, "#debugOutput", 10_000),
  ]).catch(() => undefined);
}

async function prepareLibraryCatalog(page) {
  await resetLibrary(page);
}

async function prepareLibraryBorrowed(page) {
  await resetLibrary(page);
  const before = await page.locator("#version").textContent().catch(() => "");
  await page.locator('[data-client="Front Desk"] button[data-action="borrow"]:not([disabled])').first().click();
  await page.waitForFunction((previous) => {
    const version = document.querySelector("#version")?.textContent ?? "";
    return version.trim().length > 0 && version !== previous;
  }, before, { timeout: 10_000 }).catch(() => undefined);
  await waitForLibraryBooks(page);
}

async function resetLibrary(page) {
  await page.locator("#reset").click();
  await waitForLibraryBooks(page);
}

async function focusWindow(page, name) {
  await page.locator(`[data-window-open="${name}"]`).click().catch(() => undefined);
  await page.locator(`[data-window="${name}"]`).waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
}

async function closeWindows(page, names) {
  for (const name of names) {
    const button = page.locator(`[data-window-close="${name}"]`);
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => undefined);
    }
  }
}

async function waitForText(page, selector, timeout) {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target);
    const value = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
      ? element.value
      : element?.textContent;
    return typeof value === "string" && value.trim().length > 0;
  }, selector, { timeout });
}

async function waitForLibraryBooks(page) {
  await page.waitForFunction(() => {
    const books = document.querySelectorAll("[data-books] .book").length;
    const status = document.querySelector("#connectionStatus")?.textContent ?? "";
    return books > 0 && !/(failed|invalid|error|cannot)/i.test(status);
  }, { timeout: 20_000 });
}

async function settle(page) {
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await delay(liveActions ? 900 : 500);
}

function screenshots() {
  return [
    {
      file: "gemstone-js-explorer-workspace.png",
      window: "workspace",
      prepare: prepareWorkspace,
    },
    {
      file: "gemstone-js-class-browser.png",
      window: "classes",
      prepare: prepareClassBrowser,
    },
    {
      file: "gemstone-js-debugger.png",
      window: "debugger",
      prepare: prepareDebugger,
    },
  ];
}

function libraryScreenshots() {
  return [
    {
      file: "gemstone-js-library-books-catalog.png",
      prepare: prepareLibraryCatalog,
    },
    {
      file: "gemstone-js-library-books-borrowed.png",
      prepare: prepareLibraryBorrowed,
    },
  ];
}

function startExplorer(port) {
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    "examples/explorer.ts",
    "--host",
    host,
    "--port",
    String(port),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.output = "";
  child.stdout.on("data", (chunk) => {
    child.output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    child.output += chunk;
    process.stderr.write(chunk);
  });
  return child;
}

function startLibrary(port) {
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    "examples/library-books.ts",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.output = "";
  child.stdout.on("data", (chunk) => {
    child.output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    child.output += chunk;
    process.stderr.write(chunk);
  });
  return child;
}

async function waitForExplorer(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Explorer exited before screenshots could be captured.\n${child.output || ""}`);
    }
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Explorer at ${url}: ${lastError?.message || lastError || "unknown error"}`);
}

async function waitForLibrary(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Library Books example exited before screenshots could be captured.\n${child.output || ""}`);
    }
    try {
      const response = await fetch(`${url}/api/books`);
      const text = await response.text();
      if (response.ok) {
        const payload = JSON.parse(text);
        if (Array.isArray(payload.books) && payload.books.length > 0) return;
      }
      lastError = new Error(text || `HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Library Books at ${url}: ${lastError?.message || lastError || "unknown error"}`);
}

async function stopExplorer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function resolvePlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return pathToFileURL(require.resolve("playwright")).href;
  } catch {
    return pathToFileURL("/Users/tariq/node_modules/playwright/index.js").href;
  }
}

function hasLibraryCredentials() {
  return Boolean((process.env.GS_USERNAME || process.env.GS_USER) && (process.env.GS_PASSWORD || process.env.GS_PASS));
}
