#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

const PORTABLE_ARTIFACT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.@+-]*$/;
const suffixes = process.argv.slice(2);
if (suffixes.length === 0) {
  fail("Usage: node scripts/write-checksums.mjs <suffix> [suffix...]");
}
for (const suffix of suffixes) {
  if (!suffix.startsWith(".") || suffix.length < 2) {
    fail(`Checksum suffixes must start with "." and include an extension name: ${JSON.stringify(suffix)}`);
  }
  if (suffix.includes("/") || suffix.includes("\\")) {
    fail(`Checksum suffixes must be simple extensions without path separators: ${JSON.stringify(suffix)}`);
  }
  if (/\s/.test(suffix)) {
    fail(`Checksum suffixes must be simple extensions without whitespace: ${JSON.stringify(suffix)}`);
  }
}
const uniqueSuffixes = new Set(suffixes);
if (uniqueSuffixes.size !== suffixes.length) {
  fail("Checksum suffix filters must be unique.");
}

const files = readdirSync(".")
  .filter((file) => file !== "SHA256SUMS.txt")
  .filter((file) => statSync(file).isFile())
  .filter((file) => suffixes.some((suffix) => file.endsWith(suffix)))
  .map(validateArtifactFileName)
  .sort();

if (files.length === 0) {
  fail(`No files matched checksum suffixes: ${suffixes.join(", ")}`);
}

const lines = files.map((file) => {
  const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
  return `${hash}  ${file}`;
});
writeFileSync("SHA256SUMS.txt", `${lines.join("\n")}\n`);
process.stdout.write(`Wrote SHA256SUMS.txt for ${files.length} file(s).\n`);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function validateArtifactFileName(file) {
  if (/\s/.test(file)) {
    fail(`Checksum artifact file names must not contain whitespace: ${file}`);
  }
  if (!PORTABLE_ARTIFACT_FILE_RE.test(file)) {
    fail(`Checksum artifact file names must use portable ASCII characters: ${file}`);
  }
  return file;
}
