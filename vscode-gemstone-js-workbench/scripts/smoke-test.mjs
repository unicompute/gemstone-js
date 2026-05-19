#!/usr/bin/env node

import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(extensionRoot, "..");
const captured = {
  commands: new Map(),
  debugFactories: new Map(),
  executedCommands: [],
  inputBoxValue: "new-secret",
  openedExternal: [],
  statusBars: [],
  treeProviders: new Map(),
  webviewPanels: [],
};

const configValues = {
  repoPath: "",
  nodePath: "node",
  explorerScriptPath: "",
  explorerHost: "127.0.0.1",
  explorerPort: 3117,
  openMode: "webview",
  user: "DataCurator",
  password: "legacy-password",
  stone: "gs64stone",
  netldiHost: "localhost",
  netldiNameOrPort: "netldi",
  gemService: "gemnetobject",
  nativeSessionWorker: true,
  defaultReturnKind: "inspect",
  extraEnv: {
    GS_CUSTOM: "custom",
    GS_USER: "ignored",
  },
};

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => {
      this.listeners.push(listener);
      return { dispose() {} };
    };
  }

  fire(value) {
    for (const listener of this.listeners) listener(value);
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

class DebugAdapterInlineImplementation {
  constructor(implementation) {
    this.implementation = implementation;
  }
}

const vscode = {
  DebugAdapterInlineImplementation,
  EventEmitter,
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
  ViewColumn: { One: 1 },
  Uri: {
    parse(value) {
      return { value, toString: () => value };
    },
  },
  commands: {
    registerCommand(command, callback) {
      captured.commands.set(command, callback);
      return { dispose() {} };
    },
    executeCommand(command, ...args) {
      captured.executedCommands.push({ command, args });
      return Promise.resolve();
    },
  },
  debug: {
    registerDebugAdapterDescriptorFactory(type, factory) {
      captured.debugFactories.set(type, factory);
      return { dispose() {} };
    },
    startDebugging(_folder, configuration) {
      captured.startedDebugging = configuration;
      return Promise.resolve(true);
    },
  },
  env: {
    openExternal(uri) {
      captured.openedExternal.push(uri);
      return Promise.resolve(true);
    },
  },
  window: {
    activeTextEditor: {
      selection: { isEmpty: false },
      document: {
        getText(selection) {
          return selection ? "  1 + 1  " : "self error: 'whole document'";
        },
      },
    },
    createOutputChannel() {
      return {
        append() {},
        appendLine() {},
        dispose() {},
        show() {},
      };
    },
    createWebviewPanel() {
      const panel = { webview: { html: "" } };
      captured.webviewPanels.push(panel);
      return panel;
    },
    createStatusBarItem(alignment, priority) {
      const item = {
        alignment,
        priority,
        text: "",
        tooltip: "",
        command: "",
        name: "",
        disposed: false,
        visible: false,
        dispose() {
          this.disposed = true;
        },
        show() {
          this.visible = true;
        },
      };
      captured.statusBars.push(item);
      return item;
    },
    registerTreeDataProvider(viewId, provider) {
      captured.treeProviders.set(viewId, provider);
      return { dispose() {} };
    },
    showErrorMessage(message) {
      captured.lastError = message;
      return Promise.resolve();
    },
    showInformationMessage(message) {
      captured.lastInfo = message;
      return Promise.resolve();
    },
    showInputBox(options) {
      captured.lastInputBoxOptions = options;
      return Promise.resolve(captured.inputBoxValue);
    },
    showWarningMessage(message) {
      captured.lastWarning = message;
      return Promise.resolve();
    },
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: repoRoot } }],
    getConfiguration(section) {
      assert.equal(section, "gemstoneJs");
      return {
        get(key) {
          return configValues[key];
        },
      };
    },
  },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

global.fetch = async () => {
  throw new Error("offline");
};

const extension = require(resolve(extensionRoot, "extension.js"));
const secrets = new Map([["gemstoneJs.password", "secret-password"]]);
const context = {
  extensionPath: extensionRoot,
  subscriptions: [],
  secrets: {
    async get(key) {
      return secrets.get(key);
    },
    async store(key, value) {
      secrets.set(key, value);
    },
    async delete(key) {
      secrets.delete(key);
    },
  },
};
let activated = false;

try {
  assert.equal(typeof extension.activate, "function");
  assert.equal(typeof extension.deactivate, "function");
  assert.equal(typeof extension._test.readConfig, "function");

  const config = extension._test.readConfig(context);
  assert.equal(config.repoPath, repoRoot);
  assert.equal(config.explorerHost, "127.0.0.1");
  assert.equal(config.explorerPort, 3117);
  assert.equal(config.defaultReturnKind, "inspect");
  assert.equal(config.env.GS_CUSTOM, "custom");
  assert.equal(config.env.GS_USER, "DataCurator");
  assert.equal(config.env.GS_USERNAME, "DataCurator");
  assert.equal(config.env.GS_PASS, "legacy-password");
  assert.equal(config.env.GS_PASSWORD, "legacy-password");
  assert.equal(config.passwordSource, "setting");
  assert.equal(config.env.GS_NATIVE_SESSION_WORKER, "1");

  const secretConfig = extension._test.readConfig(context, "secret-password");
  assert.equal(secretConfig.env.GS_PASS, "secret-password");
  assert.equal(secretConfig.env.GS_PASSWORD, "secret-password");
  assert.equal(secretConfig.passwordSource, "secretStorage");

  assert.equal(extension._test.selectedSource(), "1 + 1");
  assert.deepEqual(extension._test.sourceLocationForOffset("a\nbc", 4), { line: 2, column: 2 });
  assert.match(extension._test.explorerWebviewHtml("http://127.0.0.1:3117/?q=<x>"), /frame-src http:\/\/127\.0\.0\.1:3117/);
  assert.equal(
    extension._test.explorerUrl("http://127.0.0.1:3117", { window: "classes", className: "Object" }),
    "http://127.0.0.1:3117/?window=classes&class=Object",
  );

  extension.activate(context);
  activated = true;
  await waitFor(() => captured.statusBars[0]?.visible);
  await waitFor(() => captured.statusBars[0]?.text.includes("GemStone: DataCurator@gs64stone"));
  assert.equal(captured.statusBars[0].command, "gemstoneJs.doctor");
  assert.equal(captured.treeProviders.size, 4);
  assert.equal(captured.debugFactories.size, 1);

  for (const command of [
    "gemstoneJs.refreshViews",
    "gemstoneJs.refreshConnection",
    "gemstoneJs.refreshRoots",
    "gemstoneJs.refreshGlobals",
    "gemstoneJs.refreshClasses",
    "gemstoneJs.filterRoots",
    "gemstoneJs.filterGlobals",
    "gemstoneJs.filterClasses",
    "gemstoneJs.clearRootsFilter",
    "gemstoneJs.clearGlobalsFilter",
    "gemstoneJs.clearClassesFilter",
    "gemstoneJs.openExplorer",
    "gemstoneJs.openExplorerExternal",
    "gemstoneJs.openClassBrowser",
    "gemstoneJs.startExplorer",
    "gemstoneJs.stopExplorer",
    "gemstoneJs.restartExplorer",
    "gemstoneJs.doctor",
    "gemstoneJs.evaluateSelection",
    "gemstoneJs.debugSelection",
    "gemstoneJs.runFile",
    "gemstoneJs.setPassword",
    "gemstoneJs.clearPassword",
    "gemstoneJs.openSettings",
    "gemstoneJs.inspectOop",
  ]) {
    assert.equal(typeof captured.commands.get(command), "function", `missing command ${command}`);
  }

  await captured.commands.get("gemstoneJs.openSettings")();
  assert.deepEqual(captured.executedCommands.at(-1), {
    command: "workbench.action.openSettings",
    args: ["gemstoneJs"],
  });

  await captured.commands.get("gemstoneJs.setPassword")();
  assert.equal(captured.lastInputBoxOptions.password, true);
  assert.equal(secrets.get("gemstoneJs.password"), "new-secret");
  assert.equal(captured.lastInfo, "GemStone password stored in VS Code SecretStorage.");

  await captured.commands.get("gemstoneJs.clearPassword")();
  assert.equal(secrets.has("gemstoneJs.password"), false);
  assert.equal(captured.lastWarning, "SecretStorage password cleared. The legacy gemstoneJs.password setting is still configured.");

  await captured.commands.get("gemstoneJs.debugSelection")();
  assert.deepEqual(captured.startedDebugging, {
    type: "gemstone-js",
    request: "launch",
    name: "GemStone Debug Selection",
    source: "1 + 1",
    returnKind: "inspect",
  });

  const connectionProvider = captured.treeProviders.get("gemstoneJs.connectionView");
  const connectionItems = await connectionProvider.getChildren();
  assert.equal(connectionItems[0].label, "Explorer stopped or disconnected");
  assert(connectionItems.some((item) => item.label === "Start Explorer"));
  assert.equal(connectionProvider.getTreeItem(connectionItems[0]).iconPath.id, "warning");

  const fetchCalls = [];
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    const parsed = new URL(String(url));
    if (parsed.pathname === "/api/config") return jsonResponse({ roots: ["UserGlobals", "Published"] });
    if (parsed.pathname === "/api/status") return jsonResponse({ stone: "gs64stone", sessionId: "smoke" });
    if (parsed.pathname === "/api/classes") {
      const prefix = parsed.searchParams.get("prefix") || "";
      if (treeFilterExpected()) assert.equal(prefix, "Book");
      return jsonResponse({ classes: ["Booking", "BookingLine"], truncated: false });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  captured.inputBoxValue = "Book";
  await captured.commands.get("gemstoneJs.filterClasses")();
  const classProvider = captured.treeProviders.get("gemstoneJs.classesView");
  const classItems = await classProvider.getChildren();
  assert.equal(classItems[0].label, "Filter: Book");
  assert.equal(classItems[1].label, "Booking");
  const classTreeItem = classProvider.getTreeItem(classItems[1]);
  assert.equal(classTreeItem.command.command, "gemstoneJs.openClassBrowser");
  assert.deepEqual(classTreeItem.command.arguments, ["Booking"]);
  assert(fetchCalls.some((url) => url.includes("/api/classes?limit=120&prefix=Book")));

  await captured.commands.get("gemstoneJs.openClassBrowser")("Booking");
  assert.match(captured.webviewPanels.at(-1).webview.html, /window=classes&amp;class=Booking/);
  captured.inputBoxValue = "";
  await captured.commands.get("gemstoneJs.clearClassesFilter")();
  const clearedItems = await classProvider.getChildren();
  assert.notEqual(clearedItems[0].label, "Filter: Book");

  const factory = captured.debugFactories.get("gemstone-js");
  const descriptor = factory.createDebugAdapterDescriptor();
  assert(descriptor instanceof DebugAdapterInlineImplementation);
  const adapter = descriptor.implementation;
  assert.equal(typeof adapter.dispose, "function");
  const messages = [];
  adapter.onDidSendMessage((message) => messages.push(message));
  adapter.handleMessage({ seq: 1, type: "request", command: "initialize" });
  await new Promise((resolveDone) => setImmediate(resolveDone));
  assert(messages.some((message) => message.type === "response" && message.command === "initialize" && message.success));
  assert(messages.some((message) => message.type === "event" && message.event === "initialized"));

  await smokeDebugAdapter(extension._test.GemStoneDebugAdapter);

  console.log("VS Code workbench smoke test passed.");
} finally {
  if (activated) await extension.deactivate().catch(() => undefined);
  Module._load = originalLoad;
}

function treeFilterExpected() {
  return captured.inputBoxValue === "Book";
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  };
}

async function smokeDebugAdapter(GemStoneDebugAdapter) {
  const calls = [];
  const fakeServer = {
    config() {
      return { defaultReturnKind: "inspect" };
    },
    async debug(source, returnKind) {
      calls.push({ operation: "debug", source, returnKind });
      return debugPayload("debug-1", "1/0", "ZeroDivide", [
        {
          index: 0,
          selector: "SmallInteger>>/",
          printString: "SmallInteger>>/",
          source: "1/0",
          sourceOffset: 2,
          receiverOop: "42",
          receiverClass: "SmallInteger",
          variables: [
            { name: "divisor", value: "0", className: "SmallInteger" },
            { name: "receiver", oop: "42", className: "SmallInteger" },
          ],
        },
        {
          index: 1,
          selector: "ZeroDivide>>defaultAction",
          printString: "ZeroDivide>>defaultAction",
          source: "self signal",
          sourceOffset: 1,
          receiverOop: "888",
          receiverClass: "ZeroDivide",
          variables: [{ name: "exception", oop: "888", className: "ZeroDivide" }],
        },
      ]);
    },
    async debugAction(debugSessionId, action, frameIndex) {
      calls.push({ operation: "debugAction", debugSessionId, action, frameIndex });
      if (action === "terminate") return { ok: true, live: false };
      return debugPayload(debugSessionId, "1/0", `after ${action}`, [
        {
          index: 0,
          selector: "SmallInteger>>/",
          printString: "SmallInteger>>/",
          source: "1/0",
          sourceOffset: 3,
          receiverOop: "42",
          receiverClass: "SmallInteger",
          variables: [{ name: "action", value: action, className: "String" }],
        },
      ]);
    },
  };
  const adapter = new GemStoneDebugAdapter(fakeServer, vscode.window.createOutputChannel("test"));
  const messages = [];
  let seq = 10;
  adapter.onDidSendMessage((message) => messages.push(message));

  const launch = await adapterRequest(adapter, messages, seq++, "launch", {
    source: "1/0",
    returnKind: "inspect",
  });
  assert.equal(launch.success, true);
  assert(messages.some((message) => message.type === "event" && message.event === "stopped" && message.body?.reason === "exception"));
  assert.deepEqual(calls[0], { operation: "debug", source: "1/0", returnKind: "inspect" });

  const stack = await adapterRequest(adapter, messages, seq++, "stackTrace");
  assert.equal(stack.body.totalFrames, 2);
  assert.equal(stack.body.stackFrames[0].name, "SmallInteger>>/");
  assert.equal(stack.body.stackFrames[0].source.sourceReference, 1);

  const source = await adapterRequest(adapter, messages, seq++, "source", { sourceReference: 1 });
  assert.equal(source.body.content, "1/0");

  const scopes = await adapterRequest(adapter, messages, seq++, "scopes", { frameId: 1 });
  assert.deepEqual(scopes.body.scopes.map((scope) => scope.name), ["Locals", "Receiver", "GemStone"]);

  const locals = await adapterRequest(adapter, messages, seq++, "variables", {
    variablesReference: scopes.body.scopes[0].variablesReference,
  });
  assert.deepEqual(locals.body.variables[0], {
    name: "divisor",
    value: "0",
    type: "SmallInteger",
    variablesReference: 0,
  });

  const receiver = await adapterRequest(adapter, messages, seq++, "variables", {
    variablesReference: scopes.body.scopes[1].variablesReference,
  });
  assert.equal(receiver.body.variables[0].name, "receiverOop");
  assert.equal(receiver.body.variables[0].value, "42");

  const debug = await adapterRequest(adapter, messages, seq++, "variables", {
    variablesReference: scopes.body.scopes[2].variablesReference,
  });
  assert.equal(debug.body.variables[0].name, "debugSessionId");
  assert.equal(debug.body.variables[0].value, "debug-1");
  assert.equal(debug.body.variables[1].value, "777");
  assert.equal(debug.body.variables[2].value, "888");

  await adapterRequest(adapter, messages, seq++, "scopes", { frameId: 2 });
  const next = await adapterRequest(adapter, messages, seq++, "next", { threadId: 1 });
  assert.equal(next.success, true);
  assert.deepEqual(calls.at(-1), {
    operation: "debugAction",
    debugSessionId: "debug-1",
    action: "stepOver",
    frameIndex: 1,
  });
  assert(messages.some((message) => message.type === "event" && message.event === "stopped" && message.body?.reason === "stepOver"));

  await adapterRequest(adapter, messages, seq++, "disconnect");
  assert.deepEqual(calls.at(-1), {
    operation: "debugAction",
    debugSessionId: "debug-1",
    action: "terminate",
    frameIndex: 0,
  });

  const noSessionAdapter = new GemStoneDebugAdapter(fakeServer, vscode.window.createOutputChannel("test"));
  const noSessionMessages = [];
  noSessionAdapter.onDidSendMessage((message) => noSessionMessages.push(message));
  await adapterRequest(noSessionAdapter, noSessionMessages, seq++, "next", { threadId: 1 });
  assert(noSessionMessages.some((message) =>
    message.type === "event" &&
    message.event === "output" &&
    message.body?.output.includes("No live GemStone debug session is available")
  ));
}

function debugPayload(debugSessionId, source, message, frames) {
  return {
    ok: false,
    live: true,
    debugSessionId,
    source,
    returnKind: "inspect",
    elapsedMs: 1,
    problem: {
      name: "ZeroDivide",
      message,
      number: 2026,
      contextOop: "777",
      exceptionOop: "888",
      frames,
    },
  };
}

async function adapterRequest(adapter, messages, seq, command, args = undefined) {
  adapter.handleMessage({
    seq,
    type: "request",
    command,
    arguments: args,
  });
  return waitFor(() => messages.find((message) => message.type === "response" && message.request_seq === seq));
}

async function waitFor(callback) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const value = callback();
    if (value) return value;
    await new Promise((resolveDone) => setImmediate(resolveDone));
  }
  throw new Error("Timed out waiting for debug adapter response.");
}
