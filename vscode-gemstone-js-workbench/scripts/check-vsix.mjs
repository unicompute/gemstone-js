#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expectedName = `${packageJson.name}-${packageJson.version}.vsix`;
const args = process.argv.slice(2);
const checkChecksum = args.includes("--checksum");
const positionalArgs = args.filter((arg) => !arg.startsWith("--"));
const unexpectedOptions = args.filter((arg) => arg.startsWith("--") && arg !== "--checksum");
if (unexpectedOptions.length) {
  throw new Error(`Unknown option: ${unexpectedOptions.join(", ")}`);
}
const vsixPath = positionalArgs[0] ? join(process.cwd(), positionalArgs[0]) : join(root, expectedName);

if (!existsSync(vsixPath)) {
  throw new Error(`VSIX not found: ${vsixPath}`);
}

if (packageJson.icon !== "media/icon_purple.png") {
  throw new Error(`Expected package icon media/icon_purple.png, found ${packageJson.icon || "(none)"}`);
}

const archive = readFileSync(vsixPath);
const zipEntries = zipEntriesByName(archive);
const entries = [...zipEntries.keys()].sort();
const entrySet = new Set(entries);
const requiredEntries = [
  "extension/package.json",
  "extension/extension.js",
  "extension/language-configuration.json",
  "extension/readme.md",
  "extension/changelog.md",
  "extension/LICENSE.txt",
  "extension/media/icon.svg",
  "extension/media/icon_purple.png",
  "extension/snippets/smalltalk.json",
  "extension/syntaxes/smalltalk.tmLanguage.json",
];
const forbiddenPatterns = [
  /^extension\/node_modules\//,
  /^extension\/\.gitignore$/,
  /^extension\/\.vscodeignore$/,
  /^extension\/\.vscode-test\//,
  /^extension\/scripts\//,
  /^extension\/test\//,
  /^extension\/media\/gemstone-rs-graphic_purple\.png$/,
  /^extension\/.*\.vsix$/,
  /^extension\/.*\.vsix\.sha256$/,
];

for (const entry of requiredEntries) {
  if (!entrySet.has(entry)) throw new Error(`VSIX is missing required entry: ${entry}`);
}

for (const entry of entries) {
  if (forbiddenPatterns.some((pattern) => pattern.test(entry))) {
    throw new Error(`VSIX includes forbidden entry: ${entry}`);
  }
}

const packagedPackageJson = JSON.parse(zipText(archive, zipEntries.get("extension/package.json")));
const packagedSnippets = JSON.parse(zipText(archive, zipEntries.get("extension/snippets/smalltalk.json")));
const vsixManifest = zipText(archive, zipEntries.get("extension.vsixmanifest"));
assertPackagedManifest(packagedPackageJson, vsixManifest);
assertPackagedSnippets(packagedSnippets);

const digest = createHash("sha256").update(archive).digest("hex");
const checksumPath = `${vsixPath}.sha256`;

if (checkChecksum) {
  if (!existsSync(checksumPath)) {
    throw new Error(`VSIX checksum file not found: ${checksumPath}`);
  }
  const checksum = readFileSync(checksumPath, "utf8").trim().split(/\s+/);
  if (checksum[0] !== digest) {
    throw new Error(`VSIX checksum mismatch: ${checksum[0]} != ${digest}`);
  }
}

console.log(`VSIX verified: ${basename(vsixPath)} (${entries.length} entries, sha256 ${digest})`);

function assertPackagedManifest(manifest, vsixManifest) {
  const expectedCommands = [
    "gemstoneJs.openExplorer",
    "gemstoneJs.openExplorerExternal",
    "gemstoneJs.openClassBrowser",
    "gemstoneJs.inspectOop",
    "gemstoneJs.copyOop",
    "gemstoneJs.doctor",
    "gemstoneJs.evaluateSelection",
    "gemstoneJs.debugSelection",
    "gemstoneJs.runFile",
    "gemstoneJs.configureConnection",
    "gemstoneJs.setPassword",
    "gemstoneJs.clearPassword",
    "gemstoneJs.refreshConnection",
    "gemstoneJs.refreshRoots",
    "gemstoneJs.refreshGlobals",
    "gemstoneJs.refreshClasses",
    "gemstoneJs.filterRoots",
    "gemstoneJs.filterGlobals",
    "gemstoneJs.filterClasses",
  ];
  const expectedActivationEvents = [
    "onCommand:gemstoneJs.openExplorer",
    "onCommand:gemstoneJs.inspectOop",
    "onCommand:gemstoneJs.copyOop",
    "onCommand:gemstoneJs.evaluateSelection",
    "onCommand:gemstoneJs.debugSelection",
    "onCommand:gemstoneJs.configureConnection",
    "onDebugResolve:gemstone-js",
    "onView:gemstoneJs.connectionView",
    "onView:gemstoneJs.rootsView",
    "onView:gemstoneJs.globalsView",
    "onView:gemstoneJs.classesView",
  ];
  const expectedViews = [
    "gemstoneJs.connectionView",
    "gemstoneJs.rootsView",
    "gemstoneJs.globalsView",
    "gemstoneJs.classesView",
  ];

  assertEqual(manifest.name, packageJson.name, "packaged name");
  assertEqual(manifest.publisher, packageJson.publisher, "packaged publisher");
  assertEqual(manifest.version, packageJson.version, "packaged version");
  assertEqual(manifest.displayName, packageJson.displayName, "packaged displayName");
  assertEqual(manifest.main, "./extension.js", "packaged main");
  assertEqual(manifest.icon, "media/icon_purple.png", "packaged icon");
  assertArrayIncludesAll(manifest.activationEvents, expectedActivationEvents, "activationEvents");
  assertArrayIncludesAll((manifest.contributes?.commands || []).map((command) => command.command), expectedCommands, "commands");
  assertArrayIncludesAll(
    (manifest.contributes?.menus?.["view/item/context"] || []).map((menuItem) => menuItem.command),
    ["gemstoneJs.inspectOop", "gemstoneJs.copyOop", "gemstoneJs.openClassBrowser"],
    "menus.view/item/context",
  );
  assertArrayIncludesAll((manifest.contributes?.views?.gemstoneJs || []).map((view) => view.id), expectedViews, "views.gemstoneJs");
  assertArrayIncludesAll((manifest.contributes?.debuggers || []).map((debuggerEntry) => debuggerEntry.type), ["gemstone-js"], "debuggers");
  assertArrayIncludesAll((manifest.contributes?.languages || []).map((language) => language.id), ["smalltalk"], "languages");
  const smalltalkLanguage = (manifest.contributes?.languages || []).find((language) => language.id === "smalltalk");
  assertArrayIncludesAll(smalltalkLanguage?.extensions, [".st", ".gs", ".topaz"], "smalltalk language extensions");
  assertEqual(smalltalkLanguage?.configuration, "./language-configuration.json", "smalltalk language configuration");
  const smalltalkGrammar = (manifest.contributes?.grammars || []).find((grammar) => grammar.language === "smalltalk");
  assertEqual(smalltalkGrammar?.scopeName, "source.smalltalk.gemstone", "smalltalk grammar scopeName");
  assertEqual(smalltalkGrammar?.path, "./syntaxes/smalltalk.tmLanguage.json", "smalltalk grammar path");
  const smalltalkSnippets = (manifest.contributes?.snippets || []).find((snippet) => snippet.language === "smalltalk");
  assertEqual(smalltalkSnippets?.path, "./snippets/smalltalk.json", "smalltalk snippets path");
  if (!manifest.contributes?.configuration?.properties?.["gemstoneJs.nativeSessionWorker"]) {
    throw new Error("VSIX package.json is missing gemstoneJs.nativeSessionWorker setting metadata.");
  }
  if (!vsixManifest.includes(`Id="${packageJson.name}"`)) {
    throw new Error(`extension.vsixmanifest is missing Id="${packageJson.name}".`);
  }
  if (!vsixManifest.includes(`Version="${packageJson.version}"`)) {
    throw new Error(`extension.vsixmanifest is missing Version="${packageJson.version}".`);
  }
  if (!vsixManifest.includes(`Publisher="${packageJson.publisher}"`)) {
    throw new Error(`extension.vsixmanifest is missing Publisher="${packageJson.publisher}".`);
  }
  if (!vsixManifest.includes("VisualStudio.Code")) {
    throw new Error("extension.vsixmanifest is missing the VisualStudio.Code target.");
  }
}

function assertPackagedSnippets(snippets) {
  const requiredPrefixes = ["gsmethod", "gsdo", "gsondo", "gsglobal", "gsdebug"];
  const prefixes = Object.values(snippets || {}).map((snippet) => snippet?.prefix).filter(Boolean);
  for (const prefix of requiredPrefixes) {
    if (!prefixes.includes(prefix)) {
      throw new Error(`VSIX snippets/smalltalk.json is missing prefix ${prefix}.`);
    }
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Unexpected ${label}: ${actual} != ${expected}`);
  }
}

function assertArrayIncludesAll(actual, expected, label) {
  if (!Array.isArray(actual)) throw new Error(`VSIX package.json ${label} must be an array.`);
  for (const value of expected) {
    if (!actual.includes(value)) {
      throw new Error(`VSIX package.json ${label} is missing ${value}.`);
    }
  }
}

function zipText(buffer, entry) {
  if (!entry) throw new Error("Cannot read missing ZIP entry.");
  return zipBytes(buffer, entry).toString("utf8");
}

function zipBytes(buffer, entry) {
  const localOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error(`Invalid local file header signature at offset ${localOffset}`);
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}`);
}

function zipEntriesByName(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const end = centralDirectoryOffset + centralDirectorySize;
  const entries = new Map();
  let offset = centralDirectoryOffset;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central directory signature at offset ${offset}`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    entries.set(name, { compressedSize, compressionMethod, localHeaderOffset, name, uncompressedSize });
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Could not find ZIP end of central directory.");
}
