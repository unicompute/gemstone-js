"use strict";

const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

let explorer;
let output;
let providers = [];

function activate(context) {
  output = vscode.window.createOutputChannel("GemStone JS");
  explorer = new ExplorerServer(context, output);

  providers = [
    new WorkbenchTreeProvider(() => connectionItems(explorer)),
    new WorkbenchTreeProvider(() => rootsItems(explorer)),
    new WorkbenchTreeProvider(() => globalsItems(explorer)),
    new WorkbenchTreeProvider(() => classesItems(explorer)),
  ];

  const viewIds = [
    "gemstoneJs.connectionView",
    "gemstoneJs.rootsView",
    "gemstoneJs.globalsView",
    "gemstoneJs.classesView",
  ];

  for (let index = 0; index < viewIds.length; index += 1) {
    context.subscriptions.push(vscode.window.registerTreeDataProvider(viewIds[index], providers[index]));
  }

  context.subscriptions.push(
    output,
    explorer,
    vscode.commands.registerCommand("gemstoneJs.refreshViews", refreshViews),
    vscode.commands.registerCommand("gemstoneJs.openExplorer", () => openExplorer(explorer)),
    vscode.commands.registerCommand("gemstoneJs.openExplorerExternal", () => openExplorerExternal(explorer)),
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
    vscode.commands.registerCommand("gemstoneJs.runFile", () => runFile(explorer)),
    vscode.commands.registerCommand("gemstoneJs.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "gemstoneJs"),
    ),
    vscode.commands.registerCommand("gemstoneJs.inspectOop", (oop) => inspectOop(explorer, oop)),
    vscode.debug.registerDebugAdapterDescriptorFactory("gemstone-js", {
      createDebugAdapterDescriptor() {
        return new vscode.DebugAdapterInlineImplementation(new GemStoneDebugAdapter(explorer, output));
      },
    }),
  );
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
  }

  config() {
    return readConfig(this.context);
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

  dispose() {
    void this.stop();
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

async function openExplorer(server) {
  const config = server.config();
  if (config.openMode === "external") return openExplorerExternal(server);
  const baseUrl = await server.ensureStarted();
  const panel = vscode.window.createWebviewPanel(
    "gemstoneJsExplorer",
    "GemStone Explorer",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );
  panel.webview.html = explorerWebviewHtml(`${baseUrl}/`);
}

async function openExplorerExternal(server) {
  const baseUrl = await server.ensureStarted();
  await vscode.env.openExternal(vscode.Uri.parse(`${baseUrl}/`));
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
    const report = await server.doctor();
    output.appendLine("GemStone Doctor");
    output.appendLine(JSON.stringify(report, null, 2));
    vscode.window.showInformationMessage("GemStone doctor completed.");
    refreshViews();
  } catch (error) {
    output.appendLine(`GemStone doctor failed: ${error.message}`);
    vscode.window.showErrorMessage(`GemStone doctor failed: ${error.message}`);
  }
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
  if (!oop) return;
  output.show(true);
  try {
    const result = await server.get(`/api/inspect?oop=${encodeURIComponent(String(oop))}`);
    output.appendLine(`GemStone Inspect OOP ${oop}`);
    output.appendLine(JSON.stringify(result, null, 2));
  } catch (error) {
    output.appendLine(`Inspect failed: ${error.message}`);
    vscode.window.showErrorMessage(`Inspect failed: ${error.message}`);
  }
}

function selectedSource() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";
  const selection = editor.selection && !editor.selection.isEmpty
    ? editor.document.getText(editor.selection)
    : editor.document.getText();
  return selection.trim();
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
      this.sendEvent("terminated");
      return;
    }
    const selectedFrame = this.frames[0]?.index ?? 0;
    const result = await this.server.debugAction(this.debugSessionId, action, selectedFrame);
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
    commandItem("Doctor", "gemstoneJs.doctor", "beaker", "run local diagnostics"),
    commandItem("Evaluate Selection", "gemstoneJs.evaluateSelection", "run", "run selected Smalltalk"),
    commandItem("Debug Selection", "gemstoneJs.debugSelection", "debug-alt", "debug selected Smalltalk"),
    commandItem("Restart Explorer", "gemstoneJs.restartExplorer", "debug-restart", `${config.explorerHost}:${config.explorerPort}`),
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
    return (config.roots || []).map((root) => new TreeNode(root, {
      icon: "root-folder",
      childrenFactory: () => rootEntryItems(server, root),
    }));
  } catch (error) {
    return disconnectedItems(error);
  }
}

async function rootEntryItems(server, root) {
  try {
    const result = await server.get(`/api/roots?root=${encodeURIComponent(root)}&limit=80`);
    const rows = (result.entries || []).map((entry) => oopItem(entry.name, entry.oop));
    if (result.truncated) rows.push(new TreeNode("More entries available", { description: "filter in Explorer", icon: "ellipsis" }));
    return rows;
  } catch (error) {
    return errorItems(error);
  }
}

async function globalsItems(server) {
  try {
    const result = await server.get("/api/globals?limit=120");
    const rows = (result.entries || []).map((entry) => oopItem(entry.name, entry.oop));
    if (result.truncated) rows.push(new TreeNode("More globals available", { description: "filter in Explorer", icon: "ellipsis" }));
    return rows;
  } catch (error) {
    return disconnectedItems(error);
  }
}

async function classesItems(server) {
  try {
    const result = await server.get("/api/classes?limit=120");
    const rows = (result.classes || []).map((name) => new TreeNode(name, {
      icon: "symbol-class",
      command: "gemstoneJs.openExplorer",
      tooltip: "Open Explorer Class Browser",
    }));
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
    command: "gemstoneJs.inspectOop",
    arguments: [oop],
  });
}

function commandItem(label, command, icon, description) {
  return new TreeNode(label, { command, icon, description });
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

class TreeNode {
  constructor(label, options = {}) {
    this.label = label;
    Object.assign(this, options);
  }
}

function refreshViews() {
  for (const provider of providers) provider.refresh();
}

function readConfig(context) {
  const cfg = vscode.workspace.getConfiguration("gemstoneJs");
  const repoPath = resolveRepoPath(context, String(cfg.get("repoPath") || ""));
  const extraEnv = cfg.get("extraEnv") || {};
  const user = String(cfg.get("user") || "");
  const password = String(cfg.get("password") || "");
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
  };
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

module.exports = { activate, deactivate };
