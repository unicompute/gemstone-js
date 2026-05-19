#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const entries = zipEntryNames(archive);
const entrySet = new Set(entries);
const requiredEntries = [
  "extension/package.json",
  "extension/extension.js",
  "extension/readme.md",
  "extension/changelog.md",
  "extension/LICENSE.txt",
  "extension/media/icon.svg",
  "extension/media/icon_purple.png",
];
const forbiddenPatterns = [
  /^extension\/node_modules\//,
  /^extension\/\.gitignore$/,
  /^extension\/\.vscodeignore$/,
  /^extension\/\.vscode-test\//,
  /^extension\/scripts\//,
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

function zipEntryNames(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const end = centralDirectoryOffset + centralDirectorySize;
  const names = [];
  let offset = centralDirectoryOffset;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central directory signature at offset ${offset}`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    names.push(buffer.subarray(nameStart, nameEnd).toString("utf8"));
    offset = nameEnd + extraLength + commentLength;
  }

  return names.sort();
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Could not find ZIP end of central directory.");
}
