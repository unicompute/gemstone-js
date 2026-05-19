#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(root, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const changelogPath = join(root, "CHANGELOG.md");
const readmePath = join(root, "README.md");
const workflowPath = join(repoRoot, ".github", "workflows", "vscode-workbench.yml");

const errors = [];

expect(packageJson.name === "gemstone-js-workbench", "package name must stay gemstone-js-workbench");
expect(packageJson.publisher === "unicompute", "package publisher must stay unicompute");
expect(packageJson.icon === "media/icon_purple.png", "package icon must stay media/icon_purple.png");
expect(packageJson.repository?.directory === "vscode-gemstone-js-workbench", "repository.directory must point at vscode-gemstone-js-workbench");
expect(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version), `package version is not semver-like: ${packageJson.version}`);
expect(packageJson.scripts?.verify?.includes("release:check"), "npm run verify must include release:check");
expect(packageJson.scripts?.["release:package"]?.includes("scripts/release.mjs"), "release:package script must call scripts/release.mjs");
expect(packageJson.scripts?.["release:publish"]?.includes("--publish"), "release:publish script must pass --publish");

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

const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, "utf8") : "";
expect(workflow.includes("npm run release:package"), "VS Code workflow must build artifacts through npm run release:package");
expect(workflow.includes("npm run verify:vsix:checksum"), "VS Code workflow must verify downloaded VSIX checksum artifacts before publish");
expect(workflow.includes("publish-to-marketplace"), "VS Code workflow must keep the explicit publish-to-marketplace gate");

if (errors.length) {
  for (const error of errors) console.error(`release check failed: ${error}`);
  process.exit(1);
}

console.log(`VSIX release metadata verified for ${packageJson.name} ${packageJson.version}.`);

function expect(condition, message) {
  if (!condition) errors.push(message);
}
