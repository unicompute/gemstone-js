#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exampleCatalog, findExample } from "./examples-catalog.mjs";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    printUsage(process.stdout);
    return;
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(filterExamples(options.kind), null, 2)}\n`);
    return;
  }
  if (options.show) {
    const example = requireExample(options.show, options.kind);
    process.stdout.write(readFileSync(join(PACKAGE_ROOT, example.path), "utf8"));
    return;
  }
  if (options.path) {
    const example = requireExample(options.path, options.kind);
    process.stdout.write(`${join(PACKAGE_ROOT, example.path)}\n`);
    return;
  }

  process.stdout.write(formatExamples(filterExamples(options.kind)));
}

function parseArgs(args) {
  const options = {
    help: false,
    json: false,
    kind: undefined,
    path: undefined,
    show: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--kind") {
      options.kind = requiredArg(args, index, arg);
      index += 1;
    } else if (arg === "--show") {
      options.show = requiredArg(args, index, arg);
      index += 1;
    } else if (arg === "--path") {
      options.path = requiredArg(args, index, arg);
      index += 1;
    } else if (!arg.startsWith("-") && !options.show) {
      options.show = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

function requiredArg(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function filterExamples(kind) {
  if (!kind) return exampleCatalog;
  const examples = exampleCatalog.filter((entry) => entry.kind === kind);
  if (examples.length === 0) {
    const kinds = [...new Set(exampleCatalog.map((entry) => entry.kind))].sort().join(", ");
    throw new Error(`Unknown example kind ${JSON.stringify(kind)}. Available kinds: ${kinds}.`);
  }
  return examples;
}

function requireExample(name, kind) {
  const example = findExample(name);
  if (!example) {
    throw new Error(`Unknown example ${JSON.stringify(name)}. Run gemstone-js-examples --json to list examples.`);
  }
  if (kind && example.kind !== kind) {
    throw new Error(`Example ${JSON.stringify(name)} is kind ${JSON.stringify(example.kind)}, not ${JSON.stringify(kind)}.`);
  }
  return example;
}

function formatExamples(examples) {
  if (examples.length === 0) return "No gemstone-js examples matched.\n";
  const width = Math.max(...examples.map((entry) => entry.name.length));
  const lines = ["Available gemstone-js examples:"];
  for (const entry of examples) {
    const requirements = entry.requires?.length ? ` Requires: ${entry.requires.join(", ")}.` : "";
    lines.push(`  ${entry.name.padEnd(width)}  ${entry.path}  ${entry.description}${requirements}`);
  }
  lines.push("");
  lines.push("Use gemstone-js-examples --show <name> to print an example.");
  return `${lines.join("\n")}\n`;
}

function printUsage(output) {
  output.write(`Usage: gemstone-js-examples [options] [name]

Options:
  --json             Print the example catalog as JSON
  --kind <kind>      Filter by example kind
  --show <name>      Print an example file
  --path <name>      Print an example file path
  -h, --help         Show this help
`);
}
