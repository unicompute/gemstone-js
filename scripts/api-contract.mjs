#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(SCRIPT_DIR);
const DEFAULT_CONTRACT_PATH = join(SCRIPT_DIR, "public-surface.expected.json");
const PACKAGE_JSON_PATH = join(PACKAGE_ROOT, "package.json");

try {
  const exitCode = await main(process.argv.slice(2));
  process.exitCode = exitCode;
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    printUsage(process.stdout);
    return 0;
  }

  const packageJson = JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8"));
  const moduleSpecifier = options.moduleSpecifier ?? packageJson.name;
  const report = await validateApiContract({
    contractPath: options.contractPath,
    moduleSpecifier,
    packageName: packageJson.name,
    version: packageJson.version,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (report.status === "ok") {
    process.stdout.write(
      `API contract passed: ${report.actualValueExports} runtime value exports, ${report.typeExportsInContract} type exports in source contract.\n`,
    );
  } else {
    throw new Error(formatFailure(report));
  }

  return report.status === "ok" ? 0 : 1;
}

function parseArgs(args) {
  const options = {
    contractPath: DEFAULT_CONTRACT_PATH,
    help: false,
    json: false,
    moduleSpecifier: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--module") {
      options.moduleSpecifier = requiredArg(args, index, arg);
      index += 1;
    } else if (arg === "--contract") {
      options.contractPath = requiredArg(args, index, arg);
      index += 1;
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

function printUsage(output) {
  output.write(`Usage: gemstone-js-api-contract [options]

Options:
  --json                  Print a machine-readable contract report
  --module <specifier>    Module to import (default: package self-reference)
  --contract <path>       Public surface contract JSON path
  -h, --help              Show this help
`);
}

async function validateApiContract({ contractPath, moduleSpecifier, packageName, version }) {
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const expectedValueExports = sortedNames(contract.values ?? []);
  const expectedTypeExports = sortedNames(contract.types ?? []);
  const module = await import(moduleSpecifier);
  const actualValueExports = Object.keys(module).filter((name) => name !== "default").sort(compareAscii);

  const missingValueExports = expectedValueExports.filter((name) => !actualValueExports.includes(name));
  const unexpectedValueExports = actualValueExports.filter((name) => !expectedValueExports.includes(name));

  return {
    packageName,
    version,
    moduleSpecifier,
    status: missingValueExports.length === 0 && unexpectedValueExports.length === 0 ? "ok" : "failed",
    contractSource: contract.source,
    expectedValueExports: expectedValueExports.length,
    actualValueExports: actualValueExports.length,
    typeExportsInContract: expectedTypeExports.length,
    missingValueExports,
    unexpectedValueExports,
  };
}

function sortedNames(entries) {
  return entries.map((entry) => entry.name).sort(compareAscii);
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function formatFailure(report) {
  const failures = [];
  if (report.missingValueExports.length > 0) {
    failures.push(`Missing runtime value exports: ${report.missingValueExports.join(", ")}.`);
  }
  if (report.unexpectedValueExports.length > 0) {
    failures.push(`Unexpected runtime value exports: ${report.unexpectedValueExports.join(", ")}.`);
  }
  return `API contract failed for ${report.moduleSpecifier}.\n${failures.join("\n")}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
