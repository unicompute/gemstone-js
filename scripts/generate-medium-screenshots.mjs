#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const outputDir = "docs/articles/assets";
mkdirSync(outputDir, { recursive: true });

const playwright = await import(resolvePlaywright());
const chromium = playwright.chromium ?? playwright.default?.chromium;
if (!chromium) {
  throw new Error("Playwright chromium launcher was not found. Install playwright or provide /Users/tariq/node_modules/playwright.");
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });

for (const shot of screenshots()) {
  await page.setContent(articleFrame(shot), { waitUntil: "load" });
  await page.screenshot({ path: join(outputDir, shot.file), fullPage: true });
  console.log(`Wrote ${join(outputDir, shot.file)}`);
}

await browser.close();

function resolvePlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return pathToFileURL(require.resolve("playwright")).href;
  } catch {
    return pathToFileURL("/Users/tariq/node_modules/playwright/index.js").href;
  }
}

function articleFrame(shot) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(shot.title)}</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0f172a;
    --panel: #111827;
    --panel2: #172033;
    --line: #334155;
    --text: #e5e7eb;
    --muted: #94a3b8;
    --accent: #8b5cf6;
    --accent2: #22c55e;
    --warn: #f59e0b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 960px;
    background: linear-gradient(140deg, #111827 0%, #0f172a 55%, #1f2937 100%);
    color: var(--text);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
  }
  .wrap { padding: 48px; }
  .window {
    border: 1px solid rgba(148, 163, 184, 0.32);
    background: rgba(15, 23, 42, 0.92);
    box-shadow: 0 28px 90px rgba(2, 6, 23, 0.55);
    overflow: hidden;
  }
  .titlebar {
    height: 42px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(30, 41, 59, 0.72);
  }
  .dot { width: 11px; height: 11px; border-radius: 999px; background: #ef4444; }
  .dot:nth-child(2) { background: #f59e0b; }
  .dot:nth-child(3) { background: #22c55e; }
  .bar-title { margin-left: 12px; color: var(--muted); font-size: 13px; }
  .app { display: grid; grid-template-columns: 242px 1fr; min-height: 760px; }
  .side {
    border-right: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(17, 24, 39, 0.9);
    padding: 18px;
  }
  .brand { display: flex; gap: 12px; align-items: center; margin-bottom: 22px; }
  .logo {
    width: 40px; height: 40px; display: grid; place-items: center;
    background: #4f46e5; color: white; font-weight: 800; clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
  }
  .brand h1 { font-size: 16px; line-height: 1.1; margin: 0; }
  .brand span { color: var(--muted); font-size: 12px; }
  .nav { display: grid; gap: 8px; }
  .nav div, .tree-row {
    min-height: 34px; display: flex; align-items: center; gap: 10px;
    padding: 0 10px; border: 1px solid transparent; color: #cbd5e1; font-size: 13px;
  }
  .nav .active, .tree-row.active { background: rgba(139, 92, 246, 0.18); border-color: rgba(139, 92, 246, 0.55); color: white; }
  .main { padding: 22px; display: grid; gap: 18px; align-content: start; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; }
  .heading h2 { margin: 0; font-size: 24px; font-weight: 740; }
  .heading p { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
  .buttons { display: flex; gap: 8px; }
  button {
    border: 1px solid rgba(148, 163, 184, 0.32); background: #1f2937; color: var(--text);
    height: 34px; padding: 0 12px; font: inherit; font-size: 13px;
  }
  button.primary { background: #7c3aed; border-color: #a78bfa; }
  .grid { display: grid; gap: 14px; }
  .cols2 { grid-template-columns: 1fr 1fr; }
  .cols3 { grid-template-columns: 1fr 1fr 1fr; }
  .card {
    background: rgba(17, 24, 39, 0.86);
    border: 1px solid rgba(148, 163, 184, 0.22);
    padding: 16px;
  }
  .card h3 { margin: 0 0 10px; font-size: 15px; }
  .metric { font-size: 26px; font-weight: 760; margin-bottom: 4px; }
  .muted { color: var(--muted); font-size: 13px; }
  .status { display: flex; gap: 8px; align-items: center; color: #bbf7d0; }
  .pill { border: 1px solid rgba(148, 163, 184, .32); padding: 4px 8px; font-size: 12px; color: #cbd5e1; background: rgba(15,23,42,.6); }
  pre, textarea {
    width: 100%; min-height: 210px; margin: 0; padding: 14px; color: #dbeafe;
    background: #020617; border: 1px solid rgba(148, 163, 184, 0.25);
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    white-space: pre-wrap;
  }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .class-list, .stack { display: grid; gap: 7px; }
  .class-list div, .stack div { padding: 9px 10px; border: 1px solid rgba(148,163,184,.18); background: rgba(15,23,42,.58); font-size: 13px; }
  .stack .selected { border-color: var(--warn); background: rgba(245,158,11,.13); color: white; }
  .caption { margin-top: 14px; color: #cbd5e1; font-size: 13px; }
  ${shot.css || ""}
</style>
</head>
<body>
<div class="wrap">
  <div class="window">
    <div class="titlebar"><div class="dot"></div><div class="dot"></div><div class="dot"></div><div class="bar-title">${escapeHtml(shot.windowTitle)}</div></div>
    ${shot.body}
  </div>
  <div class="caption">${escapeHtml(shot.caption)}</div>
</div>
</body>
</html>`;
}

function screenshots() {
  return [
    {
      file: "gemstone-js-explorer-workspace.png",
      title: "GemStone JS Explorer Workspace",
      windowTitle: "GemStone Explorer - Workspace",
      caption: "Explorer workspace with live status, roots/globals, and Smalltalk evaluation.",
      body: appShell("Workspace", `
        <div class="toolbar">
          <div class="heading"><h2>Workspace</h2><p>Evaluate Smalltalk through a managed gemstone-js session.</p></div>
          <div class="buttons"><button>Inspect</button><button>Value</button><button class="primary">Evaluate</button></div>
        </div>
        <div class="grid cols3">
          <div class="card"><h3>Connection</h3><div class="status">● SystemUser@gs64stone</div><div class="muted">Native worker enabled</div></div>
          <div class="card"><h3>Roots</h3><div class="metric">4</div><div class="muted">UserGlobals, Globals, Published, SessionMethods</div></div>
          <div class="card"><h3>Session</h3><div class="metric">42</div><div class="muted">clean transaction state</div></div>
        </div>
        <div class="split">
          <textarea>Booking findById: 'BK-1001'
ifNil: [ self error: 'missing booking' ]</textarea>
          <pre>{
  "ok": true,
  "returnKind": "inspect",
  "result": {
    "className": "Booking",
    "oop": "281474976710721",
    "printString": "aBooking(BK-1001)"
  }
}</pre>
        </div>`),
    },
    {
      file: "gemstone-js-class-browser.png",
      title: "GemStone JS Class Browser",
      windowTitle: "GemStone Explorer - Class Browser",
      caption: "Class browser with editable method source and class-side/instance-side navigation.",
      body: appShell("Classes", `
        <div class="toolbar">
          <div class="heading"><h2>Class Browser</h2><p>Browse selectors, preview source, edit methods, and submit changes.</p></div>
          <div class="buttons"><button>Preview</button><button>File Out</button><button class="primary">Submit</button></div>
        </div>
        <div class="split">
          <div class="card">
            <h3>Classes</h3>
            <div class="class-list">
              <div>Object</div><div>Collection</div><div class="active">Booking</div><div>BookingLine</div><div>StringKeyValueDictionary</div>
            </div>
          </div>
          <div class="card">
            <h3>Booking &gt;&gt; total</h3>
            <pre>total
  ^ self lines
      inject: 0
      into: [ :sum :line | sum + line amount ]</pre>
          </div>
        </div>`),
    },
    {
      file: "gemstone-js-debugger.png",
      title: "GemStone JS Debugger",
      windowTitle: "VS Code - gemstone-js Debug Session",
      caption: "VS Code debugger surface for GemStone exceptions, including stack, locals, restart, and step controls.",
      body: appShell("Debugger", `
        <div class="toolbar">
          <div class="heading"><h2>Debugger</h2><p>Debug <code>1/0</code> through the Explorer-backed VS Code debug adapter.</p></div>
          <div class="buttons"><button>Restart</button><button>Step Over</button><button>Step In</button><button class="primary">Continue</button></div>
        </div>
        <div class="split">
          <div class="card">
            <h3>Context Stack</h3>
            <div class="stack">
              <div class="selected">SmallInteger &gt;&gt; /</div>
              <div>ZeroDivide &gt;&gt; defaultAction</div>
              <div>BlockClosure &gt;&gt; value</div>
              <div>GsNMethod &gt;&gt; _executeInContext:</div>
            </div>
          </div>
          <div class="card">
            <h3>Locals</h3>
            <pre>receiverOop: 42
receiverClass: SmallInteger
divisor: 0
exceptionOop: 7002
message: division by zero</pre>
          </div>
        </div>`),
    },
    {
      file: "gemstone-js-vscode-workbench.png",
      title: "GemStone JS VS Code Workbench",
      windowTitle: "VS Code - gemstone-js Workbench",
      caption: "The VS Code extension wraps the Explorer, tree views, diagnostics, code runner, and debugger.",
      body: `
        <div class="app" style="grid-template-columns: 74px 292px 1fr;">
          <div class="side" style="padding: 16px 10px; display:grid; gap:14px; align-content:start; justify-items:center;">
            <div class="logo">G</div><div class="pill">DB</div><div class="pill">RUN</div><div class="pill">DBG</div>
          </div>
          <div class="side">
            <div class="brand"><div class="logo">JS</div><div><h1>GemStone JS</h1><span>Workbench</span></div></div>
            <div class="tree-row active">● Connection <span style="margin-left:auto;color:#86efac">running</span></div>
            <div class="tree-row">▸ Roots</div>
            <div class="tree-row">▸ Globals</div>
            <div class="tree-row">▸ Classes</div>
            <div class="tree-row">▶ Evaluate Selection As...</div>
            <div class="tree-row">◆ Debug File As...</div>
            <div class="tree-row">⚙ Set Native Session Worker</div>
          </div>
          <div class="main">
            <div class="toolbar"><div class="heading"><h2>gemstone-js Workbench</h2><p>Status bar, tree views, command palette, and embedded Explorer.</p></div></div>
            <div class="grid cols2">
              <div class="card"><h3>Connection Summary</h3><pre>GemStone JS Connection
Explorer: http://127.0.0.1:3117/
State: running
User: SystemUser
Stone: gs64stone
Native session worker: enabled
Password source: secretStorage</pre></div>
              <div class="card"><h3>Command Palette</h3><div class="class-list"><div>GemStone: Open Explorer</div><div>GemStone: Doctor</div><div>GemStone: Evaluate Selection As...</div><div>GemStone: Debug Selection As...</div><div>GemStone: Copy Doctor Report</div></div></div>
            </div>
          </div>
        </div>`,
    },
  ];
}

function appShell(active, main) {
  const nav = ["Workspace", "Globals", "Roots", "Classes", "Debugger", "Codegen", "Status Log"];
  return `<div class="app">
    <div class="side">
      <div class="brand"><div class="logo">G</div><div><h1>GemStone Explorer</h1><span>gemstone-js</span></div></div>
      <div class="nav">${nav.map((item) => `<div class="${item === active ? "active" : ""}">${escapeHtml(item)}</div>`).join("")}</div>
    </div>
    <div class="main">${main}</div>
  </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
