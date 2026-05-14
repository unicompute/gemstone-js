#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const DEFAULT_SOURCE_PATH = "src/index.ts";
const DEFAULT_CONTRACT_PATH = "scripts/public-surface.expected.json";

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    printUsage(process.stdout);
    return;
  }

  const source = await readFile(options.sourcePath, "utf8");
  const actual = scanPublicSurface(source, options.sourcePath);

  if (options.write) {
    await writeFile(options.contractPath, `${JSON.stringify(actual, null, 2)}\n`);
    process.stdout.write(`Wrote public surface contract: ${options.contractPath}\n`);
    return;
  }

  const expected = JSON.parse(await readFile(options.contractPath, "utf8"));
  assertPublicSurface(expected, actual, options.contractPath);
  process.stdout.write(
    `Public surface check passed: ${actual.values.length} value exports, ${actual.types.length} type exports.\n`,
  );
}

function parseArgs(args) {
  const options = {
    contractPath: DEFAULT_CONTRACT_PATH,
    help: false,
    sourcePath: DEFAULT_SOURCE_PATH,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--source") {
      options.sourcePath = requiredArg(args, index, arg);
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
  output.write(`Usage: node scripts/check-public-surface.mjs [options]

Options:
  --write                 Update the committed public surface contract
  --source <path>         Source barrel to scan (default: ${DEFAULT_SOURCE_PATH})
  --contract <path>       Contract JSON path (default: ${DEFAULT_CONTRACT_PATH})
  -h, --help              Show this help
`);
}

function scanPublicSurface(source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assertNoParseDiagnostics(sourceFile, sourcePath);

  const values = [];
  const types = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) {
      continue;
    }
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
      throw new Error(`${sourcePath}: public barrel must use explicit named exports.`);
    }
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) {
      throw new Error(`${sourcePath}: public barrel exports must specify a source module.`);
    }

    const from = statement.moduleSpecifier.text;
    for (const specifier of statement.exportClause.elements) {
      const target = statement.isTypeOnly || specifier.isTypeOnly ? types : values;
      const name = specifier.name.text;
      const imported = specifier.propertyName?.text ?? name;
      target.push({
        name,
        from,
        ...(imported !== name ? { imported } : {}),
      });
    }
  }

  return {
    source: sourcePath,
    values: sortedEntries(values, "value"),
    types: sortedEntries(types, "type"),
  };
}

function sortedEntries(entries, kind) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new Error(`Duplicate ${kind} export in public barrel: ${entry.name}`);
    }
    seen.add(entry.name);
  }
  return entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

function assertNoParseDiagnostics(sourceFile, sourcePath) {
  const diagnostic = sourceFile.parseDiagnostics[0];
  if (!diagnostic) return;
  const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  throw new Error(`${sourcePath}:${position.line + 1}:${position.character + 1}: TypeScript parse error: ${message}`);
}

function assertPublicSurface(expected, actual, contractPath) {
  const failures = [
    ...compareExportGroup("value", expected.values, actual.values),
    ...compareExportGroup("type", expected.types, actual.types),
  ];
  if (expected.source !== actual.source) {
    failures.unshift(`Source path changed: expected ${format(expected.source)}, found ${format(actual.source)}.`);
  }
  if (failures.length > 0) {
    throw new Error(
      `Public surface contract drifted from ${contractPath}.\n${failures.join("\n")}\nRun npm run public-surface:write after reviewing the API change.`,
    );
  }
}

function compareExportGroup(kind, expectedEntries = [], actualEntries = []) {
  const failures = [];
  const expectedByName = new Map(expectedEntries.map((entry) => [entry.name, entry]));
  const actualByName = new Map(actualEntries.map((entry) => [entry.name, entry]));

  const missing = [...expectedByName.keys()].filter((name) => !actualByName.has(name));
  const added = [...actualByName.keys()].filter((name) => !expectedByName.has(name));
  if (missing.length > 0) failures.push(`Missing ${kind} exports: ${missing.join(", ")}.`);
  if (added.length > 0) failures.push(`Unexpected ${kind} exports: ${added.join(", ")}.`);

  for (const [name, expected] of expectedByName) {
    const actual = actualByName.get(name);
    if (!actual) continue;
    if (expected.from !== actual.from) {
      failures.push(`${kind} export ${name} source changed: expected ${format(expected.from)}, found ${format(actual.from)}.`);
    }
    if ((expected.imported ?? expected.name) !== (actual.imported ?? actual.name)) {
      failures.push(
        `${kind} export ${name} imported binding changed: expected ${format(expected.imported ?? expected.name)}, found ${format(actual.imported ?? actual.name)}.`,
      );
    }
  }

  return failures;
}

function format(value) {
  return JSON.stringify(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
