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
  openedExternal: [],
  treeProviders: new Map(),
};

const configValues = {
  repoPath: "",
  nodePath: "node",
  explorerScriptPath: "",
  explorerHost: "127.0.0.1",
  explorerPort: 3117,
  openMode: "webview",
  user: "DataCurator",
  password: "swordfish",
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
      return { webview: { html: "" } };
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
const context = { extensionPath: extensionRoot, subscriptions: [] };
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
  assert.equal(config.env.GS_PASS, "swordfish");
  assert.equal(config.env.GS_PASSWORD, "swordfish");
  assert.equal(config.env.GS_NATIVE_SESSION_WORKER, "1");

  assert.equal(extension._test.selectedSource(), "1 + 1");
  assert.deepEqual(extension._test.sourceLocationForOffset("a\nbc", 4), { line: 2, column: 2 });
  assert.match(extension._test.explorerWebviewHtml("http://127.0.0.1:3117/?q=<x>"), /frame-src http:\/\/127\.0\.0\.1:3117/);

  extension.activate(context);
  activated = true;
  assert.equal(captured.treeProviders.size, 4);
  assert.equal(captured.debugFactories.size, 1);

  for (const command of [
    "gemstoneJs.refreshViews",
    "gemstoneJs.openExplorer",
    "gemstoneJs.openExplorerExternal",
    "gemstoneJs.startExplorer",
    "gemstoneJs.stopExplorer",
    "gemstoneJs.restartExplorer",
    "gemstoneJs.doctor",
    "gemstoneJs.evaluateSelection",
    "gemstoneJs.debugSelection",
    "gemstoneJs.runFile",
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

  const connectionProvider = captured.treeProviders.get("gemstoneJs.connectionView");
  const connectionItems = await connectionProvider.getChildren();
  assert.equal(connectionItems[0].label, "Explorer stopped or disconnected");
  assert(connectionItems.some((item) => item.label === "Start Explorer"));
  assert.equal(connectionProvider.getTreeItem(connectionItems[0]).iconPath.id, "warning");

  const factory = captured.debugFactories.get("gemstone-js");
  const descriptor = factory.createDebugAdapterDescriptor();
  assert(descriptor instanceof DebugAdapterInlineImplementation);
  const adapter = descriptor.implementation;
  const messages = [];
  adapter.onDidSendMessage((message) => messages.push(message));
  adapter.handleMessage({ seq: 1, type: "request", command: "initialize" });
  await new Promise((resolveDone) => setImmediate(resolveDone));
  assert(messages.some((message) => message.type === "response" && message.command === "initialize" && message.success));
  assert(messages.some((message) => message.type === "event" && message.event === "initialized"));

  console.log("VS Code workbench smoke test passed.");
} finally {
  if (activated) await extension.deactivate().catch(() => undefined);
  Module._load = originalLoad;
}
