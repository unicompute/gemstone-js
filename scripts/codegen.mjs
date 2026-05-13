#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { renderGeneratedModule } from "../src/codegen.ts";

const { check, help, manifestPath, outputPath, extra } = parseArgs(process.argv.slice(2));

if (help) {
  printUsage(process.stdout);
  process.exit(0);
}
if (extra.length > 0) {
  fail(`Unexpected argument: ${extra[0]}`, true);
}
if (!manifestPath) {
  fail("Missing codegen manifest path.", true);
}
if (check && !outputPath) {
  fail("--check requires an output file.", true);
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  fail(`Cannot read codegen manifest ${manifestPath}: ${errorMessage(error)}`);
}

let source;
try {
  source = renderGeneratedModule(manifest);
} catch (error) {
  fail(`Cannot render codegen manifest ${manifestPath}: ${errorMessage(error)}`);
}

if (check) {
  let existing;
  try {
    existing = await readFile(outputPath, "utf8");
  } catch (error) {
    fail(`Cannot read generated output ${outputPath}: ${errorMessage(error)}`);
  }
  if (existing !== source) {
    fail(`Generated output is out of date: ${outputPath}`);
  }
  process.stdout.write(`Generated output is up to date: ${outputPath}\n`);
} else if (outputPath) {
  await writeFile(outputPath, source);
} else {
  process.stdout.write(source);
}

function parseArgs(args) {
  const positional = [];
  let check = false;
  let help = false;
  for (const arg of args) {
    if (arg === "--check") {
      check = true;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else {
      positional.push(arg);
    }
  }
  const [manifestPath, outputPath, ...extra] = positional;
  return { check, help, manifestPath, outputPath, extra };
}

function printUsage(stream) {
  stream.write([
    "Usage: npm run codegen -- [--check] <manifest.json> [output.ts]",
    "",
    "The manifest must contain a functions array accepted by renderGeneratedModule().",
    "If output.ts is omitted, generated source is written to stdout.",
    "--check compares output.ts with generated source and exits non-zero if stale.",
    "",
  ].join("\n"));
}

function fail(message, showUsage = false) {
  process.stderr.write(`${message}\n`);
  if (showUsage) printUsage(process.stderr);
  process.exit(1);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
