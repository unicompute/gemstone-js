#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { renderGeneratedModule } from "../src/codegen.ts";

const [, , manifestPath, outputPath] = process.argv;

if (!manifestPath || manifestPath === "-h" || manifestPath === "--help") {
  const stream = manifestPath ? process.stdout : process.stderr;
  stream.write([
    "Usage: npm run codegen -- <manifest.json> [output.ts]",
    "",
    "The manifest must contain a functions array accepted by renderGeneratedModule().",
    "If output.ts is omitted, generated source is written to stdout.",
    "",
  ].join("\n"));
  process.exit(manifestPath ? 0 : 1);
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  throw new Error(`Cannot read codegen manifest ${manifestPath}: ${errorMessage(error)}`);
}

const source = renderGeneratedModule(manifest);
if (outputPath) {
  await writeFile(outputPath, source);
} else {
  process.stdout.write(source);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
