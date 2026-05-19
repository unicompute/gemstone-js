#!/usr/bin/env node

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const enabled = process.env.GS_RUN_VSCODE_HOST === "1" || process.argv.includes("--force");

if (!enabled) {
  console.log("VS Code extension-host smoke skipped. Set GS_RUN_VSCODE_HOST=1 to run it.");
  process.exit(0);
}

const { runTests } = await import("@vscode/test-electron");
const workspacePath = mkdtempSync(join(tmpdir(), "gemstone-js-workbench-host-"));

await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, "test", "suite", "index.js"),
  launchArgs: [
    "--disable-extensions",
    "--disable-workspace-trust",
    "--skip-welcome",
    workspacePath,
  ],
});
