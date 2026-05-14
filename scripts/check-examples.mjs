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
const catalogPaths = new Set(exampleCatalog.map((entry) => entry.path));

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
  if (!entry.kind || !/^[a-z][a-z0-9-]*$/.test(entry.kind)) {
    throw new Error(`Example ${entry.name} has an invalid kind: ${String(entry.kind)}.`);
  }
  if (!entry.description || !entry.description.trim()) {
    throw new Error(`Example ${entry.name} is missing a description.`);
  }
  if (entry.command !== undefined && (!entry.command.trim() || /[\r\n]/.test(entry.command))) {
    throw new Error(`Example ${entry.name} has an invalid command.`);
  }
  if (entry.requires !== undefined && (!Array.isArray(entry.requires) || entry.requires.some((value) => typeof value !== "string" || !value.trim()))) {
    throw new Error(`Example ${entry.name} has an invalid requires list.`);
  }
  catalogNames.add(entry.name);
}

for (const path of entries) {
  if (!catalogPaths.has(path)) {
    throw new Error(`Example file is missing from scripts/examples-catalog.mjs: ${path}`);
  }
}

console.log(`Example check passed: ${tsExamples.length} TypeScript examples, ${jsonExamples.length} JSON examples, ${exampleCatalog.length} catalog entries.`);
