#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const PORTABLE_ARTIFACT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.@+-]*$/;
const manifest = process.argv[2] ?? "SHA256SUMS.txt";
const manifestPath = resolve(manifest);
if (!existsSync(manifestPath)) {
  fail(`Checksum manifest not found: ${manifest}`);
}

const baseDir = dirname(manifestPath);
const manifestName = basename(manifestPath);
const lines = readFileSync(manifestPath, "utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0);

if (lines.length === 0) {
  fail(`Checksum manifest is empty: ${manifest}`);
}

const seen = new Set();
for (const line of lines) {
  const match = line.match(/^([a-fA-F0-9]{64})  ([^\r\n]+)$/);
  if (!match) {
    fail(`Invalid checksum line: ${line}`);
  }
  const [, expected, fileName] = match;
  if (fileName.includes("/") || fileName.includes("\\")) {
    fail(`Checksum file entries must be basenames: ${fileName}`);
  }
  if (/\s/.test(fileName)) {
    fail(`Checksum file entries must not contain whitespace: ${fileName}`);
  }
  if (!PORTABLE_ARTIFACT_FILE_RE.test(fileName)) {
    fail(`Checksum file entries must use portable ASCII basenames: ${fileName}`);
  }
  if (fileName === manifestName || fileName === "SHA256SUMS.txt") {
    fail(`Checksum manifests must not be artifact targets: ${fileName}`);
  }
  if (seen.has(fileName)) {
    fail(`Duplicate checksum target: ${fileName}`);
  }
  seen.add(fileName);
  const filePath = resolve(baseDir, fileName);
  if (!existsSync(filePath)) {
    fail(`Checksum target not found: ${fileName}`);
  }
  if (!statSync(filePath).isFile()) {
    fail(`Checksum targets must be regular files: ${fileName}`);
  }
  const actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    fail(`Checksum mismatch for ${fileName}: expected ${expected}, got ${actual}`);
  }
}

process.stdout.write(`Verified ${lines.length} checksum(s) from ${manifest}.\n`);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
