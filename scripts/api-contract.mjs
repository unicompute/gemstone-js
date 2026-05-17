#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(SCRIPT_DIR);
const DEFAULT_CONTRACT_PATH = join(SCRIPT_DIR, "public-surface.expected.json");
const PACKAGE_JSON_PATH = join(PACKAGE_ROOT, "package.json");
const REQUIRED_BIN_ENTRIES = {
  "gemstone-js-api-contract": "./scripts/api-contract.mjs",
  "gemstone-js-benchmark-baselines": "./scripts/benchmark-baselines.mjs",
  "gemstone-js-benchmark-compare": "./scripts/benchmark-compare.mjs",
  "gemstone-js-benchmark-register": "./scripts/benchmark-register.mjs",
  "gemstone-js-benchmark-validate": "./scripts/benchmark-validate.mjs",
  "gemstone-js-benchmarks": "./scripts/benchmarks.mjs",
  "gemstone-js-bootstrap": "./scripts/bootstrap.mjs",
  "gemstone-js-compare": "./scripts/compare.mjs",
  "gemstone-js-doctor": "./scripts/doctor.mjs",
  "gemstone-js-examples": "./scripts/examples.mjs",
  "gemstone-js-inspect": "./scripts/inspect.mjs",
  "gemstone-js-migrations": "./scripts/migrations.mjs",
};
const REQUIRED_SCHEMA_EXPORTS = {
  "./schemas/benchmark-baseline-manifest.schema.json": "./schemas/benchmark-baseline-manifest.schema.json",
  "./schemas/benchmark-report.schema.json": "./schemas/benchmark-report.schema.json",
  "./schemas/codegen-manifest.schema.json": "./schemas/codegen-manifest.schema.json",
  "./schemas/comparison-report.schema.json": "./schemas/comparison-report.schema.json",
};

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
    packageJson,
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

async function validateApiContract({ contractPath, moduleSpecifier, packageJson, packageName, version }) {
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const expectedValueExports = sortedNames(contract.values ?? []);
  const expectedTypeExports = sortedNames(contract.types ?? []);
  const module = await import(moduleSpecifier);
  const actualValueExports = Object.keys(module).filter((name) => name !== "default").sort(compareAscii);

  const missingValueExports = expectedValueExports.filter((name) => !actualValueExports.includes(name));
  const unexpectedValueExports = actualValueExports.filter((name) => !expectedValueExports.includes(name));
  const packageReport = validatePackageJson(packageJson);

  return {
    packageName,
    version,
    moduleSpecifier,
    status: missingValueExports.length === 0
      && unexpectedValueExports.length === 0
      && packageReport.failures.length === 0
      && packageReport.binTargetMismatches.length === 0
      && packageReport.schemaExportMismatches.length === 0
      ? "ok"
      : "failed",
    contractSource: contract.source,
    expectedValueExports: expectedValueExports.length,
    actualValueExports: actualValueExports.length,
    typeExportsInContract: expectedTypeExports.length,
    expectedBinEntries: Object.keys(REQUIRED_BIN_ENTRIES).length,
    actualBinEntries: Object.keys(packageJson.bin ?? {}).length,
    schemaExports: Object.keys(REQUIRED_SCHEMA_EXPORTS).length,
    missingValueExports,
    unexpectedValueExports,
    packageFailures: packageReport.failures,
    binTargetMismatches: packageReport.binTargetMismatches,
    schemaExportMismatches: packageReport.schemaExportMismatches,
  };
}

function validatePackageJson(packageJson) {
  const failures = [];
  const binTargetMismatches = [];
  const schemaExportMismatches = [];

  assertField(packageJson.name, "gemstone-js", "package name", failures);
  assertField(packageJson.type, "module", "package type", failures);
  assertField(packageJson.license, "MIT", "package license", failures);
  assertField(packageJson.main, "./dist/index.js", "package main", failures);
  assertField(packageJson.types, "./dist/index.d.ts", "package types", failures);
  if (packageJson.publishConfig?.provenance !== true) {
    failures.push("publishConfig.provenance must be true.");
  }
  if (packageJson.publishConfig?.access !== "public") {
    failures.push("publishConfig.access must be public.");
  }
  if (packageJson.exports?.["."]?.import !== "./dist/index.js" || packageJson.exports?.["."]?.types !== "./dist/index.d.ts") {
    failures.push("package root export must point import/types at dist/index.js and dist/index.d.ts.");
  }
  if (!String(packageJson.engines?.node ?? "").includes(">=24")) {
    failures.push("package engines.node must require Node >=24.");
  }

  compareMap("bin", REQUIRED_BIN_ENTRIES, packageJson.bin ?? {}, binTargetMismatches);
  compareMap("schema export", REQUIRED_SCHEMA_EXPORTS, packageJson.exports ?? {}, schemaExportMismatches);

  return { failures, binTargetMismatches, schemaExportMismatches };
}

function assertField(actual, expected, label, failures) {
  if (actual !== expected) {
    failures.push(`${label} must be ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`);
  }
}

function compareMap(label, expected, actual, mismatches) {
  for (const [name, target] of Object.entries(expected)) {
    if (actual[name] !== target) {
      mismatches.push({ name, expected: target, actual: actual[name] ?? null });
    }
  }
  for (const name of Object.keys(actual)) {
    if (!(name in expected) && name.startsWith(label === "bin" ? "gemstone-js-" : "./schemas/")) {
      mismatches.push({ name, expected: null, actual: actual[name] });
    }
  }
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
  if (report.packageFailures.length > 0) {
    failures.push(...report.packageFailures);
  }
  if (report.binTargetMismatches.length > 0) {
    failures.push(`Bin target mismatches: ${JSON.stringify(report.binTargetMismatches)}.`);
  }
  if (report.schemaExportMismatches.length > 0) {
    failures.push(`Schema export mismatches: ${JSON.stringify(report.schemaExportMismatches)}.`);
  }
  return `API contract failed for ${report.moduleSpecifier}.\n${failures.join("\n")}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
