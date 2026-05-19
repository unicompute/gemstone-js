#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packagePath = join(root, "package.json");
const args = process.argv.slice(2);
const options = new Set(args.filter((arg) => arg.startsWith("--")));
const versionArgs = args.filter((arg) => !arg.startsWith("--"));

if (options.has("--help") || versionArgs.length > 1 || unknownOptions().length) {
  printUsage();
  process.exit(options.has("--help") ? 0 : 1);
}

const targetVersion = versionArgs[0];
if (targetVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
  throw new Error(`Invalid version: ${targetVersion}`);
}

const publish = options.has("--publish");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
if (targetVersion && targetVersion !== packageJson.version) {
  packageJson.version = targetVersion;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(`Updated package.json version to ${targetVersion}.`);
}

const currentPackageJson = JSON.parse(readFileSync(packagePath, "utf8"));
run("npm", ["run", "release:check"]);
run("npm", ["run", "check"]);
run("npm", ["run", "test:smoke"]);
run("npx", ["@vscode/vsce", "package", "--no-dependencies"]);

const vsixPath = join(root, `${currentPackageJson.name}-${currentPackageJson.version}.vsix`);
if (!existsSync(vsixPath)) {
  throw new Error(`Expected VSIX was not created: ${vsixPath}`);
}
run("npm", ["run", "verify:vsix"]);

const digest = createHash("sha256").update(readFileSync(vsixPath)).digest("hex");
const checksumPath = `${vsixPath}.sha256`;
writeFileSync(checksumPath, `${digest}  ${basename(vsixPath)}\n`);
console.log(`Wrote ${basename(checksumPath)}.`);
run("npm", ["run", "verify:vsix:checksum"]);

if (publish) {
  const pat = process.env.VSCE_PAT;
  if (!pat) throw new Error("VSCE_PAT must be set to publish to the Visual Studio Marketplace.");
  run("npx", [
    "@vscode/vsce",
    "publish",
    "--packagePath",
    basename(vsixPath),
    "--pat",
    pat,
    "--no-dependencies",
  ]);
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status}`);
  }
}

function unknownOptions() {
  const known = new Set(["--package-only", "--publish", "--help"]);
  return [...options].filter((option) => !known.has(option));
}

function printUsage() {
  console.log(`Usage: node scripts/release.mjs [version] [--package-only] [--publish]

Packages the current VS Code extension version, verifies the VSIX contents, and
writes a .sha256 checksum next to the artifact. Passing a version updates
package.json first; add the matching CHANGELOG.md entry before publishing.

Examples:
  npm run release:package
  npm run release -- 0.1.1
  VSCE_PAT=... npm run release:publish -- 0.1.1`);
}
