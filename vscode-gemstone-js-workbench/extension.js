"use strict";

const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const PASSWORD_SECRET_KEY = "gemstoneJs.password";

let explorer;
let output;
let providers = [];
let providerByKey = {};
let statusBar;
const treeFilters = {
  roots: "",
  globals: "",
  classes: "",
};

function activate(context) {
  output = vscode.window.createOutputChannel("GemStone JS");
  explorer = new ExplorerServer(context, output);
  statusBar = new GemStoneStatusBar(explorer);

  providerByKey = {
    connection: new WorkbenchTreeProvider(() => connectionItems(explorer)),
    roots: new WorkbenchTreeProvider(() => rootsItems(explorer)),
    globals: new WorkbenchTreeProvider(() => globalsItems(explorer)),
    classes: new WorkbenchTreeProvider(() => classesItems(explorer)),
  };
  providers = Object.values(providerByKey);

  for (const [key, viewId] of Object.entries({
    connection: "gemstoneJs.connectionView",
    roots: "gemstoneJs.rootsView",
    globals: "gemstoneJs.globalsView",
    classes: "gemstoneJs.classesView",
  })) {
    context.subscriptions.push(vscode.window.registerTreeDataProvider(viewId, providerByKey[key]));
  }

  context.subscriptions.push(
    output,
    explorer,
    statusBar,
    vscode.commands.registerCommand("gemstoneJs.refreshViews", refreshViews),
    vscode.commands.registerCommand("gemstoneJs.refreshConnection", () => refreshProvider("connection")),
    vscode.commands.registerCommand("gemstoneJs.refreshRoots", () => refreshProvider("roots")),
    vscode.commands.registerCommand("gemstoneJs.refreshGlobals", () => refreshProvider("globals")),
    vscode.commands.registerCommand("gemstoneJs.refreshClasses", () => refreshProvider("classes")),
    vscode.commands.registerCommand("gemstoneJs.filterRoots", () => promptTreeFilter("roots", "Roots and entries")),
    vscode.commands.registerCommand("gemstoneJs.filterGlobals", () => promptTreeFilter("globals", "Globals")),
    vscode.commands.registerCommand("gemstoneJs.filterClasses", () => promptTreeFilter("classes", "Classes")),
    vscode.commands.registerCommand("gemstoneJs.clearRootsFilter", () => clearTreeFilter("roots")),
    vscode.commands.registerCommand("gemstoneJs.clearGlobalsFilter", () => clearTreeFilter("globals")),
    vscode.commands.registerCommand("gemstoneJs.clearClassesFilter", () => clearTreeFilter("classes")),
    vscode.commands.registerCommand("gemstoneJs.clearTreeFilters", clearTreeFilters),
    vscode.commands.registerCommand("gemstoneJs.openOutput", () => output.show(true)),
    vscode.commands.registerCommand("gemstoneJs.openExplorer", () => openExplorer(explorer)),
    vscode.commands.registerCommand("gemstoneJs.openExplorerExternal", () => openExplorerExternal(explorer)),
    vscode.commands.registerCommand("gemstoneJs.copyExplorerUrl", () => copyExplorerUrl(explorer)),
    vscode.commands.registerCommand("gemstoneJs.copyConnectionSummary", () => copyConnectionSummary(explorer)),
    vscode.commands.registerCommand("gemstoneJs.copyDoctorReport", () => copyDoctorReport(explorer)),
    vscode.commands.registerCommand("gemstoneJs.openClassBrowser", (className) => openClassBrowser(explorer, commandArgumentValue(className))),
    vscode.commands.registerCommand("gemstoneJs.openWorkspace", () => openExplorerWindow(explorer, "workspace")),
    vscode.commands.registerCommand("gemstoneJs.openGlobals", () => openExplorerWindow(explorer, "globals")),
    vscode.commands.registerCommand("gemstoneJs.openRoots", () => openExplorerWindow(explorer, "roots")),
    vscode.commands.registerCommand("gemstoneJs.openSymbolList", () => openExplorerWindow(explorer, "symbols")),
    vscode.commands.registerCommand("gemstoneJs.openCodegen", () => openExplorerWindow(explorer, "codegen")),
    vscode.commands.registerCommand("gemstoneJs.openStatusLog", () => openExplorerWindow(explorer, "statusLog")),
    vscode.commands.registerCommand("gemstoneJs.startExplorer", async () => {
      await explorer.ensureStarted();
      refreshViews();
    }),
    vscode.commands.registerCommand("gemstoneJs.stopExplorer", async () => {
      await explorer.stop();
      refreshViews();
    }),
    vscode.commands.registerCommand("gemstoneJs.restartExplorer", async () => {
      await explorer.restart();
      refreshViews();
    }),
    vscode.commands.registerCommand("gemstoneJs.doctor", () => runDoctor(explorer)),
    vscode.commands.registerCommand("gemstoneJs.evaluateSelection", () => evaluateSelection(explorer)),
    vscode.commands.registerCommand("gemstoneJs.debugSelection", () => debugSelection(explorer)),
    vscode.commands.registerCommand("gemstoneJs.debugFile", () => debugFile(explorer)),
    vscode.commands.registerCommand("gemstoneJs.runFile", () => runFile(explorer)),
    vscode.commands.registerCommand("gemstoneJs.configureConnection", () => configureConnection(explorer)),
    vscode.commands.registerCommand("gemstoneJs.setPassword", () => setPassword(explorer)),
    vscode.commands.registerCommand("gemstoneJs.clearPassword", () => clearPassword(explorer)),
    vscode.commands.registerCommand("gemstoneJs.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "gemstoneJs"),
    ),
    vscode.commands.registerCommand("gemstoneJs.inspectOop", (oop) => inspectOop(explorer, oop)),
    vscode.commands.registerCommand("gemstoneJs.copyOop", (oop) => copyOop(oop)),
    vscode.commands.registerCommand("gemstoneJs.copyObjectName", (name) => copyObjectName(name)),
    vscode.commands.registerCommand("gemstoneJs.copyClassName", (className) => copyClassName(className)),
    vscode.debug.registerDebugAdapterDescriptorFactory("gemstone-js", {
      createDebugAdapterDescriptor() {
        return new vscode.DebugAdapterInlineImplementation(new GemStoneDebugAdapter(explorer, output));
      },
    }),
  );
  void explorer.loadSecretPassword().then(() => refreshStatusBar());
}

async function deactivate() {
  if (explorer) await explorer.stop();
}

class ExplorerServer {
  constructor(context, outputChannel) {
    this.context = context;
    this.output = outputChannel;
    this.process = undefined;
    this.starting = undefined;
    this.secretPassword = undefined;
  }

  config() {
    return readConfig(this.context, this.secretPassword);
  }

  baseUrl() {
    const config = this.config();
    return `http://${config.explorerHost}:${config.explorerPort}`;
  }

  async ensureStarted() {
    if (await this.isRunning()) return this.baseUrl();
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  async restart() {
    await this.stop();
    return this.ensureStarted();
  }

  async stop() {
    if (this.process && !this.process.killed) {
      this.output.appendLine("Stopping gemstone-js Explorer.");
      this.process.kill();
    }
    this.process = undefined;
  }

  async start() {
    await this.loadSecretPassword();
    const config = this.config();
    const explorerScript = config.explorerScriptPath || path.join(config.repoPath, "examples", "explorer.ts");
    if (!fs.existsSync(explorerScript)) {
      throw new Error(`Explorer script not found: ${explorerScript}`);
    }

    const args = [
      "--experimental-strip-types",
      explorerScript,
      "--host",
      config.explorerHost,
      "--port",
      String(config.explorerPort),
    ];
    const env = { ...process.env, ...config.env };
    this.output.appendLine(`Starting gemstone-js Explorer: ${config.nodePath} ${args.join(" ")}`);
    this.process = cp.spawn(config.nodePath, args, {
      cwd: config.repoPath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process.stdout.on("data", (chunk) => this.output.append(String(chunk)));
    this.process.stderr.on("data", (chunk) => this.output.append(String(chunk)));
    this.process.on("exit", (code, signal) => {
      this.output.appendLine(`gemstone-js Explorer exited: code=${code ?? ""} signal=${signal ?? ""}`);
      this.process = undefined;
      refreshViews();
    });

    await this.waitUntilRunning(10000);
    return this.baseUrl();
  }

  async waitUntilRunning(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        await this.get("/api/config", false);
        return;
      } catch (error) {
        lastError = error;
        await delay(150);
      }
    }
    throw new Error(`Explorer did not start before timeout: ${lastError?.message ?? "unknown error"}`);
  }

  async isRunning() {
    try {
      await this.get("/api/config", false);
      return true;
    } catch {
      return false;
    }
  }

  async get(apiPath, startIfNeeded = true) {
    if (startIfNeeded) await this.ensureStarted();
    return requestJson(`${this.baseUrl()}${apiPath}`);
  }

  async post(apiPath, body) {
    await this.ensureStarted();
    return requestJson(`${this.baseUrl()}${apiPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async status(startIfNeeded = true) {
    return this.get("/api/status", startIfNeeded);
  }

  async doctor() {
    return this.get("/api/doctor");
  }

  async evaluate(source, returnKind) {
    return this.post("/api/eval", {
      source,
      returnKind,
      commit: false,
    });
  }

  async debug(source, returnKind) {
    return this.post("/api/debug", { source, returnKind });
  }

  async debugAction(debugSessionId, action, frameIndex) {
    return this.post("/api/debug/action", { debugSessionId, action, frameIndex });
  }

  async loadSecretPassword() {
    if (!this.context.secrets || typeof this.context.secrets.get !== "function") {
      this.secretPassword = "";
      return this.secretPassword;
    }
    this.secretPassword = await this.context.secrets.get(PASSWORD_SECRET_KEY) || "";
    return this.secretPassword;
  }

  async setPassword(password) {
    if (!this.context.secrets || typeof this.context.secrets.store !== "function") {
      throw new Error("VS Code SecretStorage is not available in this extension host.");
    }
    await this.context.secrets.store(PASSWORD_SECRET_KEY, password);
    this.secretPassword = password;
  }

  async clearPassword() {
    if (this.context.secrets && typeof this.context.secrets.delete === "function") {
      await this.context.secrets.delete(PASSWORD_SECRET_KEY);
    }
    this.secretPassword = "";
  }

  dispose() {
    void this.stop();
  }
}

class GemStoneStatusBar {
  constructor(server) {
    this.server = server;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.name = "GemStone JS";
    this.item.command = "gemstoneJs.doctor";
    this.item.text = "$(debug-disconnect) GemStone: stopped";
    this.item.tooltip = "GemStone Explorer is not connected. Click to run Doctor.";
    this.item.show();
  }

  async refresh() {
    const config = this.server.config();
    const user = config.env.GS_USER || "GemStone";
    const configuredStone = config.env.GS_STONE || "stone";
    const worker = config.env.GS_NATIVE_SESSION_WORKER ? " worker" : "";
    try {
      const status = await this.server.status(false);
      const stone = String(status.stone || status.config?.stone || configuredStone);
      this.item.text = `$(database) GemStone: ${user}@${stone}${worker}`;
      this.item.tooltip = [
        "GemStone Explorer is running.",
        `User: ${user}`,
        `Stone: ${stone}`,
        `Explorer: ${this.server.baseUrl()}`,
        `Native session worker: ${config.env.GS_NATIVE_SESSION_WORKER ? "enabled" : "disabled"}`,
      ].join("\n");
      this.item.command = "gemstoneJs.openExplorer";
    } catch {
      this.item.text = `$(debug-disconnect) GemStone: ${user}@${configuredStone}`;
      this.item.tooltip = [
        "GemStone Explorer is stopped or unreachable.",
        `User: ${user}`,
        `Stone: ${configuredStone}`,
        `Explorer: ${this.server.baseUrl()}`,
        `Native session worker: ${config.env.GS_NATIVE_SESSION_WORKER ? "enabled" : "disabled"}`,
        "Click to run Doctor.",
      ].join("\n");
      this.item.command = "gemstoneJs.doctor";
    }
    this.item.show();
  }

  dispose() {
    this.item.dispose();
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && body.error ? body.error : `HTTP ${response.status}`;
    const error = new Error(message);
    error.body = body;
    throw error;
  }
  return body;
}

async function openExplorer(server, options = {}) {
  const config = server.config();
  if (config.openMode === "external") return openExplorerExternal(server, options);
  const baseUrl = await server.ensureStarted();
  const url = explorerUrl(baseUrl, options);
  const panel = vscode.window.createWebviewPanel(
    "gemstoneJsExplorer",
    options.className ? `GemStone Explorer: ${options.className}` : "GemStone Explorer",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );
  panel.webview.html = explorerWebviewHtml(url);
}

async function openExplorerExternal(server, options = {}) {
  const baseUrl = await server.ensureStarted();
  await vscode.env.openExternal(vscode.Uri.parse(explorerUrl(baseUrl, options)));
}

async function copyExplorerUrl(server) {
  const baseUrl = await server.ensureStarted();
  const url = explorerUrl(baseUrl);
  await vscode.env.clipboard.writeText(url);
  vscode.window.showInformationMessage(`Copied Explorer URL ${url}`);
}

async function copyConnectionSummary(server) {
  const config = server.config();
  let status;
  let statusError;
  try {
    status = await server.status(false);
  } catch (error) {
    statusError = error;
  }
  const statusStone = String(status?.stone || status?.config?.stone || config.raw.stone || "");
  const lines = [
    "GemStone JS Connection",
    `Explorer: ${server.baseUrl()}`,
    `State: ${status ? "running" : "stopped"}`,
    `User: ${config.raw.user || "(unset)"}`,
    `Stone: ${statusStone || "(unset)"}`,
  ];
  if (statusStone && config.raw.stone && statusStone !== config.raw.stone) {
    lines.push(`Configured stone: ${config.raw.stone}`);
  }
  lines.push(
    `NetLDI: ${config.raw.netldiHost || "(unset)"}:${config.raw.netldiNameOrPort || "(unset)"}`,
    `Gem service: ${config.raw.gemService || "(unset)"}`,
    `Native session worker: ${config.raw.nativeSessionWorker ? "enabled" : "disabled"}`,
    `Password source: ${config.passwordSource}`,
  );
  if (status?.sessionId !== undefined) lines.push(`Session: ${status.sessionId}`);
  if (statusError) lines.push(`Status error: ${statusError.message}`);
  const summary = lines.join("\n");
  await vscode.env.clipboard.writeText(summary);
  vscode.window.showInformationMessage("Copied GemStone connection summary.");
}

async function copyDoctorReport(server) {
  output.show(true);
  try {
    await server.loadSecretPassword();
    const report = redactSecrets(await server.doctor());
    const text = `GemStone JS Doctor\n${JSON.stringify(report, null, 2)}`;
    output.appendLine(text);
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage("Copied GemStone doctor report.");
    refreshViews();
  } catch (error) {
    output.appendLine(`GemStone doctor failed: ${error.message}`);
    vscode.window.showErrorMessage(`GemStone doctor failed: ${error.message}`);
  } finally {
    refreshStatusBar();
  }
}

async function openClassBrowser(server, className) {
  let name = String(className || "").trim();
  if (!name) name = selectedClassNameCandidate();
  if (!name) {
    const answer = await vscode.window.showInputBox({
      prompt: "GemStone class name",
      placeHolder: "Object",
      ignoreFocusOut: true,
    });
    if (answer === undefined) return;
    name = answer.trim();
  }
  if (!name) {
    await openExplorer(server, { window: "classes" });
    return;
  }
  await openExplorer(server, { window: "classes", className: name });
}

async function openExplorerWindow(server, windowName) {
  await openExplorer(server, { window: windowName });
}

function explorerUrl(baseUrl, options = {}) {
  const url = new URL(`${baseUrl}/`);
  if (options.window) url.searchParams.set("window", String(options.window));
  if (options.className) url.searchParams.set("class", String(options.className));
  if (options.dictionary) url.searchParams.set("dictionary", String(options.dictionary));
  if (options.oop !== undefined && options.oop !== null && String(options.oop).trim()) {
    url.searchParams.set("oop", String(options.oop).trim());
  }
  return url.toString();
}

function explorerWebviewHtml(explorerUrl) {
  const safeUrl = escapeHtml(explorerUrl);
  const frameOrigin = escapeHtml(new URL(explorerUrl).origin);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${frameOrigin}; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GemStone Explorer</title>
  <style>
    html, body, iframe { width: 100%; height: 100%; margin: 0; padding: 0; border: 0; overflow: hidden; background: #111827; }
  </style>
</head>
<body>
  <iframe src="${safeUrl}" title="GemStone Explorer"></iframe>
</body>
</html>`;
}

async function runDoctor(server) {
  output.show(true);
  try {
    await server.loadSecretPassword();
    const report = redactSecrets(await server.doctor());
    output.appendLine("GemStone Doctor");
    output.appendLine(JSON.stringify(report, null, 2));
    vscode.window.showInformationMessage("GemStone doctor completed.");
    refreshViews();
  } catch (error) {
    output.appendLine(`GemStone doctor failed: ${error.message}`);
    vscode.window.showErrorMessage(`GemStone doctor failed: ${error.message}`);
  } finally {
    refreshStatusBar();
  }
}

async function setPassword(server) {
  const password = await vscode.window.showInputBox({
    prompt: "GemStone password",
    placeHolder: "Stored in VS Code SecretStorage",
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) return;
  if (password.length === 0) {
    await clearPassword(server);
    return;
  }
  await server.setPassword(password);
  vscode.window.showInformationMessage("GemStone password stored in VS Code SecretStorage.");
  refreshViews();
}

async function clearPassword(server) {
  await server.clearPassword();
  const config = server.config();
  if (config.passwordSource === "setting") {
    vscode.window.showWarningMessage("SecretStorage password cleared. The legacy gemstoneJs.password setting is still configured.");
  } else {
    vscode.window.showInformationMessage("GemStone SecretStorage password cleared.");
  }
  refreshViews();
}

async function configureConnection(server) {
  const config = server.config();
  const current = {
    user: config.raw.user,
    stone: config.raw.stone,
    netldiHost: config.raw.netldiHost,
    netldiNameOrPort: config.raw.netldiNameOrPort,
    gemService: config.raw.gemService,
    nativeSessionWorker: config.raw.nativeSessionWorker,
  };
  const next = {};
  for (const field of [
    ["user", "GemStone user", current.user],
    ["stone", "GemStone stone", current.stone],
    ["netldiHost", "NetLDI host", current.netldiHost],
    ["netldiNameOrPort", "NetLDI name or port", current.netldiNameOrPort],
    ["gemService", "Gem service", current.gemService],
  ]) {
    const [key, prompt, value] = field;
    const answer = await vscode.window.showInputBox({
      prompt,
      value: String(value || ""),
      ignoreFocusOut: true,
    });
    if (answer === undefined) return;
    next[key] = answer.trim();
  }

  const workerOptions = [
    { label: "Disabled", value: false },
    { label: "Enabled", value: true },
  ].sort((left, right) => Number(right.value === current.nativeSessionWorker) - Number(left.value === current.nativeSessionWorker));
  const workerChoice = await vscode.window.showQuickPick(
    workerOptions,
    {
      placeHolder: "Native session worker",
      ignoreFocusOut: true,
    },
  );
  if (!workerChoice) return;
  next.nativeSessionWorker = Boolean(workerChoice.value);

  const password = await vscode.window.showInputBox({
    prompt: "GemStone password",
    placeHolder: "Leave blank to keep the current SecretStorage password",
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) return;

  const settings = vscode.workspace.getConfiguration("gemstoneJs");
  const target = configurationTarget();
  for (const [key, value] of Object.entries(next)) {
    await settings.update(key, value, target);
  }
  if (password.length > 0) {
    await server.setPassword(password);
  }
  await server.stop();
  await server.loadSecretPassword();
  vscode.window.showInformationMessage("GemStone connection settings updated.");
  refreshViews();
}

async function evaluateSelection(server) {
  const source = selectedSource();
  if (!source) {
    vscode.window.showWarningMessage("No Smalltalk source selected.");
    return;
  }
  const returnKind = server.config().defaultReturnKind;
  output.show(true);
  try {
    const result = await server.evaluate(source, returnKind);
    output.appendLine("GemStone Evaluate Selection");
    output.appendLine(JSON.stringify(result, null, 2));
    vscode.window.showInformationMessage("GemStone evaluation completed.");
    refreshViews();
  } catch (error) {
    output.appendLine(`GemStone evaluation failed: ${error.message}`);
    output.appendLine(JSON.stringify(error.body ?? {}, null, 2));
    vscode.window.showErrorMessage(`GemStone evaluation failed: ${error.message}`);
    await debugSource(server, source, returnKind, true);
  }
}

async function runFile(server) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor.");
    return;
  }
  const source = editor.document.getText();
  if (!source.trim()) {
    vscode.window.showWarningMessage("Active file is empty.");
    return;
  }
  const returnKind = server.config().defaultReturnKind;
  output.show(true);
  try {
    const result = await server.evaluate(source, returnKind);
    output.appendLine(`GemStone Run File: ${editor.document.fileName}`);
    output.appendLine(JSON.stringify(result, null, 2));
    vscode.window.showInformationMessage("GemStone file run completed.");
    refreshViews();
  } catch (error) {
    output.appendLine(`GemStone file run failed: ${error.message}`);
    output.appendLine(JSON.stringify(error.body ?? {}, null, 2));
    vscode.window.showErrorMessage(`GemStone file run failed: ${error.message}`);
    await debugSource(server, source, returnKind, true);
  }
}

async function debugSelection(server) {
  const source = selectedSource();
  if (!source) {
    vscode.window.showWarningMessage("No Smalltalk source selected.");
    return;
  }
  await vscode.debug.startDebugging(undefined, {
    type: "gemstone-js",
    request: "launch",
    name: "GemStone Debug Selection",
    source,
    returnKind: server.config().defaultReturnKind,
  });
}

async function debugFile(server) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor.");
    return;
  }
  const source = editor.document.getText();
  if (!source.trim()) {
    vscode.window.showWarningMessage("Active file is empty.");
    return;
  }
  await vscode.debug.startDebugging(undefined, {
    type: "gemstone-js",
    request: "launch",
    name: "GemStone Debug File",
    source,
    returnKind: server.config().defaultReturnKind,
  });
}

async function debugSource(server, source, returnKind, openWorkbench) {
  output.show(true);
  const result = await server.debug(source, returnKind);
  output.appendLine("GemStone Debug");
  output.appendLine(JSON.stringify(debugSummary(result), null, 2));
  if (openWorkbench && result && result.live) {
    await openExplorer(server);
  }
  refreshViews();
  return result;
}

async function inspectOop(server, oop) {
  oop = commandArgumentValue(oop);
  let value = oop === undefined || oop === null ? "" : String(oop).trim();
  if (!value) value = selectedOopCandidate();
  if (!value) {
    const answer = await vscode.window.showInputBox({
      prompt: "GemStone object OOP",
      placeHolder: "123456789",
      ignoreFocusOut: true,
    });
    if (answer === undefined) return;
    value = answer.trim();
  }
  if (!value) {
    vscode.window.showWarningMessage("No OOP provided.");
    return;
  }
  await openExplorer(server, { window: "inspect", oop: value });
}

async function copyOop(oop) {
  oop = commandArgumentValue(oop);
  let value = oop === undefined || oop === null ? "" : String(oop).trim();
  if (!value) value = selectedOopCandidate();
  if (!value) {
    const answer = await vscode.window.showInputBox({
      prompt: "GemStone object OOP",
      placeHolder: "123456789",
      ignoreFocusOut: true,
    });
    if (answer === undefined) return;
    value = answer.trim();
  }
  if (!value) {
    vscode.window.showWarningMessage("No OOP provided.");
    return;
  }
  await vscode.env.clipboard.writeText(value);
  vscode.window.showInformationMessage(`Copied OOP ${value}.`);
}

async function copyObjectName(name) {
  name = commandArgumentLabel(name);
  let value = name === undefined || name === null ? "" : String(name).trim();
  if (!value) {
    const answer = await vscode.window.showInputBox({
      prompt: "GemStone object name",
      placeHolder: "Object",
      ignoreFocusOut: true,
    });
    if (answer === undefined) return;
    value = answer.trim();
  }
  if (!value) {
    vscode.window.showWarningMessage("No object name provided.");
    return;
  }
  await vscode.env.clipboard.writeText(value);
  vscode.window.showInformationMessage(`Copied object name ${value}.`);
}

async function copyClassName(className) {
  className = commandArgumentValue(className);
  let value = className === undefined || className === null ? "" : String(className).trim();
  if (!value) {
    const answer = await vscode.window.showInputBox({
      prompt: "GemStone class name",
      placeHolder: "Object",
      ignoreFocusOut: true,
    });
    if (answer === undefined) return;
    value = answer.trim();
  }
  if (!value) {
    vscode.window.showWarningMessage("No class name provided.");
    return;
  }
  await vscode.env.clipboard.writeText(value);
  vscode.window.showInformationMessage(`Copied class ${value}.`);
}

function commandArgumentValue(value) {
  if (value && typeof value === "object" && Array.isArray(value.arguments) && value.arguments.length > 0) {
    return value.arguments[0];
  }
  return value;
}

function commandArgumentLabel(value) {
  if (value && typeof value === "object") {
    if (Array.isArray(value.arguments) && value.arguments.length > 1) return value.arguments[1];
    if (value.label !== undefined) return value.label;
  }
  return value;
}

function selectedSource() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";
  const selection = editor.selection && !editor.selection.isEmpty
    ? editor.document.getText(editor.selection)
    : editor.document.getText();
  return selection.trim();
}

function selectedClassNameCandidate() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.selection || editor.selection.isEmpty) return "";
  const value = String(editor.document.getText(editor.selection) || "").trim();
  return /^[A-Z][A-Za-z0-9_]*$/.test(value) ? value : "";
}

function selectedOopCandidate() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.selection || editor.selection.isEmpty) return "";
  const value = String(editor.document.getText(editor.selection) || "").trim();
  return /^[0-9]+$/.test(value) ? value : "";
}

function debugSummary(result) {
  if (!result || typeof result !== "object") return result;
  return {
    ok: result.ok,
    live: result.live,
    debugSessionId: result.debugSessionId,
    elapsedMs: result.elapsedMs,
    result: result.result,
    problem: result.problem ? {
      name: result.problem.name,
      message: result.problem.message,
      number: result.problem.number,
      contextOop: result.problem.contextOop,
      exceptionOop: result.problem.exceptionOop,
      frames: Array.isArray(result.problem.frames) ? result.problem.frames.length : 0,
    } : undefined,
  };
}

class GemStoneDebugAdapter {
  constructor(server, outputChannel) {
    this.server = server;
    this.output = outputChannel;
    this.seq = 1;
    this.eventEmitter = new vscode.EventEmitter();
    this.onDidSendMessage = this.eventEmitter.event;
    this.debugSessionId = undefined;
    this.source = "";
    this.returnKind = "inspect";
    this.frames = [];
    this.result = undefined;
    this.selectedFrameId = undefined;
    this.variableHandles = new Map();
    this.nextVariableReference = 1000;
  }

  handleMessage(message) {
    void this.dispatch(message).catch((error) => {
      this.sendResponse(message, undefined, false, error.message);
      this.sendEvent("output", { category: "stderr", output: `${error.message}\n` });
    });
  }

  async dispatch(message) {
    switch (message.command) {
      case "initialize":
        this.sendResponse(message, {
          supportsConfigurationDoneRequest: true,
          supportsRestartRequest: true,
          supportsStepInTargetsRequest: false,
          supportsSetVariable: false,
          supportsEvaluateForHovers: false,
          supportsRestartFrame: true,
        });
        this.sendEvent("initialized");
        break;
      case "launch":
        await this.launch(message);
        break;
      case "configurationDone":
        this.sendResponse(message);
        break;
      case "threads":
        this.sendResponse(message, { threads: [{ id: 1, name: "GemStone" }] });
        break;
      case "stackTrace":
        this.sendResponse(message, { stackFrames: this.stackFrames(), totalFrames: this.frames.length });
        break;
      case "source":
        this.sendResponse(message, { content: this.sourceForReference(message.arguments?.sourceReference) });
        break;
      case "scopes":
        this.scopes(message);
        break;
      case "variables":
        this.variables(message);
        break;
      case "continue":
        await this.action(message, "proceed");
        break;
      case "next":
        await this.action(message, "stepOver");
        break;
      case "stepIn":
        await this.action(message, "stepInto");
        break;
      case "stepOut":
        await this.action(message, "stepReturn");
        break;
      case "restart":
        await this.action(message, "restart");
        break;
      case "restartFrame":
        await this.action(message, "restart");
        break;
      case "disconnect":
        await this.disconnect(message);
        break;
      case "setBreakpoints":
        this.sendResponse(message, { breakpoints: [] });
        break;
      default:
        this.sendResponse(message);
        break;
    }
  }

  async launch(message) {
    const args = message.arguments ?? {};
    this.source = String(args.source || selectedSource() || "");
    this.returnKind = String(args.returnKind || this.server.config().defaultReturnKind || "inspect");
    if (!this.source.trim()) {
      throw new Error("No GemStone source provided for debug launch.");
    }
    this.result = await debugSource(this.server, this.source, this.returnKind, false);
    this.applyResult(this.result);
    this.sendResponse(message);
    if (this.result.ok) {
      this.sendEvent("output", { category: "stdout", output: `GemStone result: ${JSON.stringify(this.result.result ?? this.result.resultOop)}\n` });
      this.sendEvent("terminated");
    } else {
      this.sendEvent("stopped", { reason: "exception", threadId: 1, allThreadsStopped: true });
    }
  }

  async action(message, action) {
    if (!this.debugSessionId) {
      this.sendResponse(message);
      this.sendEvent("output", {
        category: "stderr",
        output: "No live GemStone debug session is available. Run GemStone: Debug Selection on code that raises or halts first.\n",
      });
      this.sendEvent("terminated");
      return;
    }
    const selectedFrame = this.frameForId(message.arguments?.frameId || this.selectedFrameId);
    const selectedFrameIndex = Number(selectedFrame.index ?? 0);
    const result = await this.server.debugAction(this.debugSessionId, action, selectedFrameIndex);
    this.result = result;
    this.applyResult(result);
    this.sendResponse(message, { allThreadsContinued: false });
    if (result.ok && !result.live) {
      this.sendEvent("terminated");
    } else {
      this.sendEvent("stopped", { reason: action, threadId: 1, allThreadsStopped: true });
    }
  }

  async disconnect(message) {
    if (this.debugSessionId) {
      await this.server.debugAction(this.debugSessionId, "terminate", 0).catch(() => undefined);
      this.debugSessionId = undefined;
    }
    this.sendResponse(message);
    this.sendEvent("terminated");
  }

  dispose() {
    if (this.debugSessionId) {
      void this.server.debugAction(this.debugSessionId, "terminate", 0).catch(() => undefined);
      this.debugSessionId = undefined;
    }
    if (this.eventEmitter && typeof this.eventEmitter.dispose === "function") {
      this.eventEmitter.dispose();
    }
  }

  applyResult(result) {
    this.debugSessionId = result?.debugSessionId;
    this.frames = Array.isArray(result?.problem?.frames) ? result.problem.frames : [];
    this.variableHandles.clear();
    this.nextVariableReference = 1000;
  }

  stackFrames() {
    return this.frames.map((frame, index) => {
      const line = Number(frame.line || sourceLocationForOffset(frame.source || this.source, frame.sourceOffset || 0).line || 1);
      return {
        id: Number(frame.index ?? index) + 1,
        name: frame.printString || frame.selector || `Frame ${index}`,
        source: {
          name: frame.selector || "GemStone",
          sourceReference: Number(frame.index ?? index) + 1,
        },
        line: Math.max(1, line),
        column: 1,
      };
    });
  }

  sourceForReference(sourceReference) {
    const frame = this.frames.find((item, index) => Number(item.index ?? index) + 1 === Number(sourceReference));
    return String(frame?.source || this.source || "");
  }

  scopes(message) {
    const frame = this.frameForId(message.arguments?.frameId);
    this.selectedFrameId = message.arguments?.frameId;
    const scopes = [
      {
        name: "Locals",
        variablesReference: this.referenceFor({ kind: "locals", frame }),
        expensive: false,
      },
      {
        name: "Receiver",
        variablesReference: this.referenceFor({ kind: "receiver", frame }),
        expensive: false,
      },
      {
        name: "GemStone",
        variablesReference: this.referenceFor({ kind: "debug", frame }),
        expensive: false,
      },
    ];
    this.sendResponse(message, { scopes });
  }

  variables(message) {
    const ref = this.variableHandles.get(Number(message.arguments?.variablesReference));
    if (!ref) {
      this.sendResponse(message, { variables: [] });
      return;
    }
    const frame = ref.frame || {};
    if (ref.kind === "locals") {
      const variables = Array.isArray(frame.variables) ? frame.variables : [];
      this.sendResponse(message, {
        variables: variables.map((variable) => ({
          name: String(variable.name || ""),
          value: String(variable.value || variable.oop || ""),
          type: String(variable.className || ""),
          variablesReference: 0,
        })),
      });
      return;
    }
    if (ref.kind === "receiver") {
      this.sendResponse(message, {
        variables: [
          { name: "receiverOop", value: String(frame.receiverOop || ""), type: String(frame.receiverClass || ""), variablesReference: 0 },
          { name: "receiverClass", value: String(frame.receiverClass || ""), variablesReference: 0 },
          { name: "selector", value: String(frame.selector || ""), variablesReference: 0 },
        ],
      });
      return;
    }
    this.sendResponse(message, {
      variables: [
        { name: "debugSessionId", value: String(this.debugSessionId || ""), variablesReference: 0 },
        { name: "contextOop", value: String(this.result?.problem?.contextOop || ""), variablesReference: 0 },
        { name: "exceptionOop", value: String(this.result?.problem?.exceptionOop || ""), variablesReference: 0 },
        { name: "message", value: String(this.result?.problem?.message || ""), variablesReference: 0 },
      ],
    });
  }

  frameForId(frameId) {
    return this.frames.find((frame, index) => Number(frame.index ?? index) + 1 === Number(frameId)) || this.frames[0] || {};
  }

  referenceFor(value) {
    const reference = this.nextVariableReference;
    this.nextVariableReference += 1;
    this.variableHandles.set(reference, value);
    return reference;
  }

  sendResponse(request, body, success = true, message) {
    this.eventEmitter.fire({
      seq: this.seq++,
      type: "response",
      request_seq: request.seq,
      command: request.command,
      success,
      message,
      body,
    });
  }

  sendEvent(event, body) {
    this.eventEmitter.fire({
      seq: this.seq++,
      type: "event",
      event,
      body,
    });
  }
}

class WorkbenchTreeProvider {
  constructor(factory) {
    this.factory = factory;
    this.eventEmitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.eventEmitter.event;
  }

  refresh() {
    this.eventEmitter.fire(undefined);
  }

  getTreeItem(item) {
    const treeItem = new vscode.TreeItem(
      item.label,
      item.childrenFactory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    treeItem.description = item.description;
    treeItem.tooltip = item.tooltip || item.description;
    treeItem.iconPath = new vscode.ThemeIcon(item.icon || "circle-outline");
    treeItem.contextValue = item.contextValue;
    if (item.command) {
      treeItem.command = {
        command: item.command,
        title: item.label,
        arguments: item.arguments || [],
      };
    }
    return treeItem;
  }

  getChildren(item) {
    if (item && item.childrenFactory) return item.childrenFactory();
    return this.factory();
  }
}

async function connectionItems(server) {
  const config = server.config();
  const items = [
    commandItem("Open Explorer", "gemstoneJs.openExplorer", "browser", "webview or browser"),
    commandItem("Open in Browser", "gemstoneJs.openExplorerExternal", "link-external", "system browser"),
    commandItem("Copy Explorer URL", "gemstoneJs.copyExplorerUrl", "copy", `${config.explorerHost}:${config.explorerPort}`),
    commandItem("Copy Connection Summary", "gemstoneJs.copyConnectionSummary", "copy", `${config.raw.user}@${config.raw.stone}`),
    commandItem("Copy Doctor Report", "gemstoneJs.copyDoctorReport", "copy", "redacted diagnostics"),
    commandItem("Configure Connection", "gemstoneJs.configureConnection", "settings", "connection settings"),
    commandItem("Workspace", "gemstoneJs.openWorkspace", "edit", "evaluate Smalltalk"),
    commandItem("Globals", "gemstoneJs.openGlobals", "globe", "browse UserGlobals"),
    commandItem("Roots", "gemstoneJs.openRoots", "root-folder", "browse persistent roots"),
    commandItem("Symbol List", "gemstoneJs.openSymbolList", "list-tree", "browse symbol dictionaries"),
    commandItem("Codegen", "gemstoneJs.openCodegen", "code", "preview wrappers"),
    commandItem("Status Log", "gemstoneJs.openStatusLog", "output", "recent Explorer activity"),
    commandItem("Output", "gemstoneJs.openOutput", "output", "GemStone JS output channel"),
    commandItem("Clear Tree Filters", "gemstoneJs.clearTreeFilters", "clear-all", "roots, globals, classes"),
    commandItem("Doctor", "gemstoneJs.doctor", "beaker", "run local diagnostics"),
    commandItem("Evaluate Selection", "gemstoneJs.evaluateSelection", "run", "run selected Smalltalk"),
    commandItem("Debug Selection", "gemstoneJs.debugSelection", "debug-alt", "debug selected Smalltalk"),
    commandItem("Debug File", "gemstoneJs.debugFile", "debug-alt", "debug active editor contents"),
    commandItem("Run File", "gemstoneJs.runFile", "play", "run active editor contents"),
    commandItem("Inspect OOP", "gemstoneJs.inspectOop", "search", "open object inspector"),
    commandItem("Stop Explorer", "gemstoneJs.stopExplorer", "debug-stop", `${config.explorerHost}:${config.explorerPort}`),
    commandItem("Restart Explorer", "gemstoneJs.restartExplorer", "debug-restart", `${config.explorerHost}:${config.explorerPort}`),
    commandItem("Set Password", "gemstoneJs.setPassword", "key", "store password in SecretStorage"),
    commandItem("Clear Password", "gemstoneJs.clearPassword", "trash", "clear SecretStorage password"),
  ];
  try {
    const status = await server.status(false);
    items.unshift(new TreeNode("Connected", {
      description: String(status.stone || status.config?.stone || ""),
      tooltip: JSON.stringify(status, null, 2),
      icon: "pass-filled",
    }));
    items.push(new TreeNode("Session", {
      description: `id ${status.sessionId}`,
      icon: "database",
    }));
    items.push(new TreeNode("Transaction", {
      description: `in=${Boolean(status.inTransaction)} needsCommit=${Boolean(status.needsCommit)}`,
      icon: status.needsCommit ? "warning" : "check",
    }));
  } catch (error) {
    items.unshift(new TreeNode("Explorer stopped or disconnected", {
      description: error.message,
      icon: "warning",
    }));
    items.push(commandItem("Start Explorer", "gemstoneJs.startExplorer", "play", `${config.explorerHost}:${config.explorerPort}`));
  }
  items.push(commandItem("Settings", "gemstoneJs.openSettings", "settings-gear", "gemstoneJs"));
  return items;
}

async function rootsItems(server) {
  try {
    const config = await server.get("/api/config");
    return [
      ...filterHeaderItems("roots", "Roots/entries"),
      ...(config.roots || []).map((root) => new TreeNode(root, {
      icon: "root-folder",
      childrenFactory: () => rootEntryItems(server, root),
      })),
    ];
  } catch (error) {
    return disconnectedItems(error);
  }
}

async function rootEntryItems(server, root) {
  try {
    const filter = treeFilters.roots;
    const result = await server.get(`/api/roots?root=${encodeURIComponent(root)}&limit=80${filterQuery(filter)}`);
    const rows = (result.entries || []).map((entry) => oopItem(entry.name, entry.oop));
    if (result.truncated) rows.push(new TreeNode("More entries available", { description: "filter in Explorer", icon: "ellipsis" }));
    return rows;
  } catch (error) {
    return errorItems(error);
  }
}

async function globalsItems(server) {
  try {
    const filter = treeFilters.globals;
    const result = await server.get(`/api/globals?limit=120${filterQuery(filter)}`);
    const rows = [
      ...filterHeaderItems("globals", "Globals"),
      ...(result.entries || []).map((entry) => oopItem(entry.name, entry.oop)),
    ];
    if (result.truncated) rows.push(new TreeNode("More globals available", { description: "filter in Explorer", icon: "ellipsis" }));
    return rows;
  } catch (error) {
    return disconnectedItems(error);
  }
}

async function classesItems(server) {
  try {
    const filter = treeFilters.classes;
    const result = await server.get(`/api/classes?limit=120${prefixQuery(filter)}`);
    const rows = [
      ...filterHeaderItems("classes", "Classes"),
      ...(result.classes || []).map((name) => new TreeNode(name, {
      icon: "symbol-class",
      contextValue: "gemstoneJs.class",
      command: "gemstoneJs.openClassBrowser",
      arguments: [name],
      tooltip: "Open Explorer Class Browser",
      })),
    ];
    if (result.truncated) rows.push(new TreeNode("More classes available", { description: "filter in Explorer", icon: "ellipsis" }));
    return rows;
  } catch (error) {
    return disconnectedItems(error);
  }
}

function oopItem(label, oop) {
  return new TreeNode(label, {
    description: oop,
    tooltip: `OOP ${oop}`,
    icon: "symbol-field",
    contextValue: "gemstoneJs.oop",
    command: "gemstoneJs.inspectOop",
    arguments: [oop, label],
  });
}

function commandItem(label, command, icon, description) {
  return new TreeNode(label, { command, icon, description });
}

function filterHeaderItems(key, label) {
  const filter = treeFilters[key];
  if (!filter) return [];
  const clearCommand = {
    roots: "gemstoneJs.clearRootsFilter",
    globals: "gemstoneJs.clearGlobalsFilter",
    classes: "gemstoneJs.clearClassesFilter",
  }[key];
  return [
    new TreeNode(`Filter: ${filter}`, {
      description: label,
      icon: "filter",
      command: clearCommand,
      tooltip: "Click to clear this tree filter.",
    }),
  ];
}

function filterQuery(filter) {
  return filter ? `&filter=${encodeURIComponent(filter)}` : "";
}

function prefixQuery(prefix) {
  return prefix ? `&prefix=${encodeURIComponent(prefix)}` : "";
}

function disconnectedItems(error) {
  return [
    new TreeNode("Explorer unavailable", { description: error.message, icon: "warning" }),
    commandItem("Start Explorer", "gemstoneJs.startExplorer", "play", ""),
  ];
}

function errorItems(error) {
  return [new TreeNode("Load failed", { description: error.message, icon: "error" })];
}

function redactSecrets(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const array = value.map((item) => redactSecrets(item, seen));
    seen.delete(value);
    return array;
  }
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = isSensitiveKey(key, entry) ? "<redacted>" : redactSecrets(entry, seen);
  }
  seen.delete(value);
  return result;
}

function isSensitiveKey(key, value) {
  const lower = String(key || "").toLowerCase();
  if (typeof value === "boolean" && lower.endsWith("set")) return false;
  return lower === "pass" ||
    lower === "password" ||
    lower === "token" ||
    lower === "authorization" ||
    lower.includes("password") ||
    lower.includes("_pass") ||
    lower.includes("-pass") ||
    lower.includes("secret") ||
    lower.includes("credential") ||
    lower.endsWith("token") ||
    lower.endsWith("pat") ||
    lower.includes("_token");
}

class TreeNode {
  constructor(label, options = {}) {
    this.label = label;
    Object.assign(this, options);
  }
}

function refreshViews() {
  for (const provider of providers) provider.refresh();
  refreshStatusBar();
}

function refreshProvider(key) {
  providerByKey[key]?.refresh();
  refreshStatusBar();
}

async function promptTreeFilter(key, label) {
  const value = await vscode.window.showInputBox({
    prompt: `Filter ${label}`,
    value: treeFilters[key],
    placeHolder: key === "classes" ? "Class name prefix" : "Name contains",
  });
  if (value === undefined) return;
  treeFilters[key] = value.trim();
  refreshProvider(key);
}

function clearTreeFilter(key) {
  treeFilters[key] = "";
  refreshProvider(key);
}

function clearTreeFilters() {
  for (const key of Object.keys(treeFilters)) treeFilters[key] = "";
  refreshViews();
}

function refreshStatusBar() {
  if (statusBar) void statusBar.refresh();
}

function readConfig(context, secretPassword) {
  const cfg = vscode.workspace.getConfiguration("gemstoneJs");
  const repoPath = resolveRepoPath(context, String(cfg.get("repoPath") || ""));
  const extraEnv = cfg.get("extraEnv") || {};
  const user = String(cfg.get("user") || "");
  const settingPassword = String(cfg.get("password") || "");
  const password = secretPassword ? secretPassword : settingPassword;
  const passwordSource = secretPassword ? "secretStorage" : settingPassword ? "setting" : "empty";
  const stone = String(cfg.get("stone") || "");
  const netldiHost = String(cfg.get("netldiHost") || "");
  const netldiNameOrPort = String(cfg.get("netldiNameOrPort") || "");
  const gemService = String(cfg.get("gemService") || "");
  const nativeSessionWorker = Boolean(cfg.get("nativeSessionWorker"));
  const env = {
    ...stringRecord(extraEnv),
    GS_USER: user,
    GS_USERNAME: user,
    GS_PASS: password,
    GS_PASSWORD: password,
    GS_STONE: stone,
    GS_STONE_NAME: stone,
    GS_NETLDI_HOST: netldiHost,
    GS_HOST: netldiHost,
    GS_NETLDI_NAME_OR_PORT: netldiNameOrPort,
    GS_NETLDI: netldiNameOrPort,
    GS_GEM_SERVICE: gemService,
    GS_NATIVE_SESSION_WORKER: nativeSessionWorker ? "1" : "",
  };
  return {
    repoPath,
    nodePath: String(cfg.get("nodePath") || "node"),
    explorerScriptPath: String(cfg.get("explorerScriptPath") || ""),
    explorerHost: String(cfg.get("explorerHost") || "127.0.0.1"),
    explorerPort: Number(cfg.get("explorerPort") || 3117),
    openMode: String(cfg.get("openMode") || "webview"),
    defaultReturnKind: String(cfg.get("defaultReturnKind") || "inspect"),
    env,
    passwordSource,
    raw: {
      gemService,
      nativeSessionWorker,
      netldiHost,
      netldiNameOrPort,
      stone,
      user,
    },
  };
}

function configurationTarget() {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function resolveRepoPath(context, configuredPath) {
  if (configuredPath) return expandHome(configuredPath);
  const extensionParent = path.dirname(context.extensionPath);
  if (looksLikeGemstoneJsRepo(extensionParent)) return extensionParent;
  for (const folder of vscode.workspace.workspaceFolders || []) {
    if (looksLikeGemstoneJsRepo(folder.uri.fsPath)) return folder.uri.fsPath;
    const child = path.join(folder.uri.fsPath, "gemstone-js");
    if (looksLikeGemstoneJsRepo(child)) return child;
  }
  return extensionParent;
}

function looksLikeGemstoneJsRepo(dir) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return packageJson.name === "gemstone-js" && fs.existsSync(path.join(dir, "examples", "explorer.ts"));
  } catch {
    return false;
  }
}

function stringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

function expandHome(value) {
  if (!value.startsWith("~")) return value;
  return path.join(require("node:os").homedir(), value.slice(1));
}

function sourceLocationForOffset(source, offset) {
  const text = String(source || "");
  const point = Number(offset || 0);
  if (!text || point <= 1) return { line: 1, column: 1 };
  let line = 1;
  let column = 1;
  for (let index = 0; index < Math.min(text.length, point - 1); index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  activate,
  deactivate,
  _test: {
    GemStoneDebugAdapter,
    explorerWebviewHtml,
    explorerUrl,
    configurationTarget,
    readConfig,
    resolveRepoPath,
    selectedSource,
    selectedClassNameCandidate,
    selectedOopCandidate,
    sourceLocationForOffset,
  },
};
