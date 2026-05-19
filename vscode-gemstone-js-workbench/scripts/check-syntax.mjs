#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = [
  join(root, "extension.js"),
  ...collect(join(root, "scripts")),
  ...collect(join(root, "test")),
].filter((file) => /\.(?:cjs|js|mjs)$/.test(file));
const jsonFiles = [
  join(root, "package.json"),
  join(root, "language-configuration.json"),
  ...collect(join(root, "snippets")).filter((file) => file.endsWith(".json")),
  ...collect(join(root, "syntaxes")).filter((file) => file.endsWith(".json")),
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Syntax check failed: ${relative(root, file)}`);
  }
}

for (const file of jsonFiles) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (file.includes(`${pathSeparator()}snippets${pathSeparator()}`)) {
      validateSnippets(file, parsed);
    }
  } catch (error) {
    throw new Error(`JSON syntax check failed: ${relative(root, file)}: ${error.message}`);
  }
}

console.log(`Syntax check passed: ${files.length} JavaScript files, ${jsonFiles.length} JSON files.`);

function collect(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collect(path));
    } else {
      files.push(path);
    }
  }
  return files.sort();
}

function validateSnippets(file, snippets) {
  const requiredPrefixes = ["gsmethod", "gsdo", "gsondo", "gsglobal", "gsdebug"];
  const prefixes = Object.values(snippets || {}).map((snippet) => snippet?.prefix).filter(Boolean);
  for (const prefix of requiredPrefixes) {
    if (!prefixes.includes(prefix)) {
      throw new Error(`Snippet file ${relative(root, file)} is missing prefix ${prefix}`);
    }
  }
  for (const [name, snippet] of Object.entries(snippets || {})) {
    if (!snippet.description || !snippet.prefix || !snippet.body) {
      throw new Error(`Snippet ${name} in ${relative(root, file)} must define description, prefix, and body.`);
    }
  }
}

function pathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}
