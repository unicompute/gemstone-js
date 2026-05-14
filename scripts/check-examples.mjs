#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleCatalog } from "./examples-catalog.mjs";

const examplesDir = "examples";
const entries = readdirSync(examplesDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(examplesDir, entry.name))
  .sort();

const tsExamples = entries.filter((path) => path.endsWith(".ts"));
const jsonExamples = entries.filter((path) => path.endsWith(".json"));

for (const path of tsExamples) {
  execFileSync(process.execPath, ["--experimental-strip-types", "--check", path], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

for (const path of jsonExamples) {
  JSON.parse(readFileSync(path, "utf8"));
}

for (const required of exampleCatalog.map((entry) => entry.path)) {
  if (!entries.includes(required)) {
    throw new Error(`Missing required example: ${required}`);
  }
}

const catalogNames = new Set();
for (const entry of exampleCatalog) {
  if (catalogNames.has(entry.name)) {
    throw new Error(`Duplicate example catalog name: ${entry.name}`);
  }
  catalogNames.add(entry.name);
}

console.log(`Example check passed: ${tsExamples.length} TypeScript examples, ${jsonExamples.length} JSON examples, ${exampleCatalog.length} catalog entries.`);
