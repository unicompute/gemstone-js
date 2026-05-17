#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (!existsSync("tsconfig.build.json")) {
  if (existsSync(join("dist", "index.js")) && existsSync(join("dist", "index.d.ts"))) process.exit(0);
  throw new Error("Cannot build dist: tsconfig.build.json is missing and dist is not already present.");
}

execFileSync("tsc", ["-p", "tsconfig.build.json"], {
  encoding: "utf8",
  stdio: "inherit",
});

rewriteDeclarations("dist");

function rewriteDeclarations(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      rewriteDeclarations(path);
    } else if (entry.isFile() && path.endsWith(".d.ts")) {
      const source = readFileSync(path, "utf8");
      const rewritten = source
        .replace(/(from\s+["']\.[^"']+)\.ts(["'])/g, "$1.js$2")
        .replace(/(import\(\s*["']\.[^"']+)\.ts(["']\s*\))/g, "$1.js$2");
      if (rewritten !== source) writeFileSync(path, rewritten);
    }
  }
}
