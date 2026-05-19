"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension("unicompute.gemstone-js-workbench");
  assert(extension, "gemstone-js Workbench extension should be discoverable by id");
  await extension.activate();

  const packageJson = require(path.join(extension.extensionPath, "package.json"));
  assert.equal(packageJson.name, "gemstone-js-workbench");
  assert.equal(packageJson.publisher, "unicompute");
  assert(packageJson.contributes.debuggers.some((debuggerEntry) => debuggerEntry.type === "gemstone-js"));
  assert.equal(packageJson.contributes.views.gemstoneJs.length, 4);

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "gemstoneJs.openExplorer",
    "gemstoneJs.doctor",
    "gemstoneJs.evaluateSelection",
    "gemstoneJs.debugSelection",
    "gemstoneJs.configureConnection",
    "gemstoneJs.refreshRoots",
    "gemstoneJs.filterClasses",
    "gemstoneJs.openClassBrowser",
    "gemstoneJs.setPassword",
    "gemstoneJs.clearPassword",
  ]) {
    assert(commands.includes(command), `missing registered command ${command}`);
  }

  const config = vscode.workspace.getConfiguration("gemstoneJs");
  const target = vscode.ConfigurationTarget.Workspace;
  await config.update("repoPath", extension.extensionPath, target);
  await config.update("explorerScriptPath", path.join(extension.extensionPath, "test", "fixtures", "fake-explorer.js"), target);
  await config.update("explorerPort", 43117, target);
  await config.update("openMode", "webview", target);

  try {
    await vscode.commands.executeCommand("gemstoneJs.refreshViews");
    await vscode.commands.executeCommand("gemstoneJs.openExplorer");
    await vscode.commands.executeCommand("gemstoneJs.doctor");
    await debugSmoke();
  } finally {
    await vscode.commands.executeCommand("gemstoneJs.stopExplorer");
  }
}

async function debugSmoke() {
  const started = onceDebugSession("start", "GemStone JS Host Smoke");
  const terminated = onceDebugSession("terminate", "GemStone JS Host Smoke");
  const ok = await vscode.debug.startDebugging(undefined, {
    type: "gemstone-js",
    request: "launch",
    name: "GemStone JS Host Smoke",
    source: "1/0",
    returnKind: "inspect",
  });
  assert.equal(ok, true, "debug session should start");
  await withTimeout(started, 5000, "debug session start");
  await vscode.debug.stopDebugging();
  await withTimeout(terminated, 5000, "debug session termination");
}

function onceDebugSession(kind, name) {
  return new Promise((resolve) => {
    let disposable;
    const listener = (session) => {
      if (session.name !== name) return;
      disposable.dispose();
      resolve(session);
    };
    disposable = kind === "start"
      ? vscode.debug.onDidStartDebugSession(listener)
      : vscode.debug.onDidTerminateDebugSession(listener);
  });
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { run };
