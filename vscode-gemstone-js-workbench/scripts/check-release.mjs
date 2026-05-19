#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(root, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const changelogPath = join(root, "CHANGELOG.md");
const readmePath = join(root, "README.md");
const fakeExplorerPath = join(root, "test", "fixtures", "fake-explorer.js");
const hostTestPath = join(root, "test", "suite", "index.js");
const hostRunnerPath = join(root, "scripts", "run-extension-host-test.mjs");
const languageConfigurationPath = join(root, "language-configuration.json");
const smalltalkGrammarPath = join(root, "syntaxes", "smalltalk.tmLanguage.json");
const vsixCheckPath = join(root, "scripts", "check-vsix.mjs");
const workflowPath = join(repoRoot, ".github", "workflows", "vscode-workbench.yml");

const errors = [];

expect(packageJson.name === "gemstone-js-workbench", "package name must stay gemstone-js-workbench");
expect(packageJson.publisher === "unicompute", "package publisher must stay unicompute");
expect(packageJson.icon === "media/icon_purple.png", "package icon must stay media/icon_purple.png");
expect(packageJson.repository?.directory === "vscode-gemstone-js-workbench", "repository.directory must point at vscode-gemstone-js-workbench");
expect(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version), `package version is not semver-like: ${packageJson.version}`);
expect(packageJson.scripts?.check?.includes("check-syntax.mjs"), "check script must syntax-check extension scripts and tests");
expect(readFileSync(join(root, "scripts", "check-syntax.mjs"), "utf8").includes("language-configuration.json"), "check-syntax.mjs must parse language JSON assets");
expect(packageJson.scripts?.verify?.includes("release:check"), "npm run verify must include release:check");
expect(packageJson.scripts?.["release:package"]?.includes("scripts/release.mjs"), "release:package script must call scripts/release.mjs");
expect(packageJson.scripts?.["release:publish"]?.includes("--publish"), "release:publish script must pass --publish");
expect(packageJson.scripts?.["test:host"]?.includes("run-extension-host-test.mjs"), "test:host script must call the VS Code extension-host runner");
expect(packageJson.devDependencies?.["@vscode/test-electron"], "@vscode/test-electron must be a devDependency for extension-host smoke tests");
expect((packageJson.contributes?.languages || []).some((language) => language.id === "smalltalk"), "package.json must contribute the smalltalk language id");
expect((packageJson.contributes?.grammars || []).some((grammar) => grammar.language === "smalltalk"), "package.json must contribute a smalltalk grammar");

expect(existsSync(changelogPath), "CHANGELOG.md must exist");
const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
expect(
  changelog.includes(`## ${packageJson.version} -`) || changelog.includes(`## [${packageJson.version}]`),
  `CHANGELOG.md must contain an entry for ${packageJson.version}`,
);
expect(changelog.includes("VSIX packaging"), "CHANGELOG.md should mention VSIX packaging/release verification");

const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
expect(readme.includes("npm run release:package"), "README.md must document npm run release:package");
expect(readme.includes("npm run release:publish"), "README.md must document npm run release:publish");
expect(readme.includes("CHANGELOG.md"), "README.md must document the changelog requirement");
expect(readme.includes("GS_RUN_VSCODE_HOST=1 npm run test:host"), "README.md must document the opt-in extension-host smoke test");

expect(existsSync(hostRunnerPath), "scripts/run-extension-host-test.mjs must exist");
expect(existsSync(fakeExplorerPath), "test/fixtures/fake-explorer.js must exist");
expect(existsSync(hostTestPath), "test/suite/index.js must exist");
expect(existsSync(languageConfigurationPath), "language-configuration.json must exist");
expect(existsSync(smalltalkGrammarPath), "syntaxes/smalltalk.tmLanguage.json must exist");

const vsixCheck = existsSync(vsixCheckPath) ? readFileSync(vsixCheckPath, "utf8") : "";
expect(vsixCheck.includes("assertPackagedManifest"), "check-vsix.mjs must validate the packaged manifest metadata");
expect(vsixCheck.includes("extension.vsixmanifest"), "check-vsix.mjs must inspect extension.vsixmanifest");
expect(vsixCheck.includes("onDebugResolve:gemstone-js"), "check-vsix.mjs must validate debugger activation metadata");
expect(vsixCheck.includes("source.smalltalk.gemstone"), "check-vsix.mjs must validate smalltalk grammar metadata");

const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
expect(workflow.includes("npm run release:package"), "VS Code workflow must build artifacts through npm run release:package");
expect(workflow.includes("npm run verify:vsix:checksum"), "VS Code workflow must verify downloaded VSIX checksum artifacts before publish");
expect(workflow.includes("publish-to-marketplace"), "VS Code workflow must keep the explicit publish-to-marketplace gate");
expect(workflow.includes("run-extension-host-tests"), "VS Code workflow must expose an explicit extension-host test gate");

if (errors.length) {
  for (const error of errors) console.error(`release check failed: ${error}`);
  process.exit(1);
}

console.log(`VSIX release metadata verified for ${packageJson.name} ${packageJson.version}.`);

function expect(condition, message) {
  if (!condition) errors.push(message);
}
