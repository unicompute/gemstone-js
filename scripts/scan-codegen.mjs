#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { inferSelector, validateGeneratedModuleOptions } from "../src/codegen.ts";

const { help, outputPath, sourcePaths, extra } = parseArgs(process.argv.slice(2));

if (help) {
  printUsage(process.stdout);
  process.exit(0);
}
if (extra.length > 0) {
  fail(`Unexpected argument: ${extra[0]}`, true);
}
if (sourcePaths.length === 0) {
  fail("Missing TypeScript source path.", true);
}

const functions = [];
const imports = new Map();
for (const sourcePath of sourcePaths) {
  const source = await readFile(sourcePath, "utf8");
  const sourceFunctions = scanSource(source, sourcePath);
  functions.push(...sourceFunctions);
  collectUsedTypeImports(scanImports(source), sourceFunctions, imports);
}

const manifest = {
  $schema: "./schemas/codegen-manifest.schema.json",
  ...(imports.size > 0 ? { imports: renderTypeImports(imports) } : {}),
  functions,
};
validateGeneratedModuleOptions(manifest);
const rendered = `${JSON.stringify(manifest, null, 2)}\n`;

if (outputPath) {
  await writeFile(outputPath, rendered);
} else {
  process.stdout.write(rendered);
}

function scanSource(source, sourcePath) {
  const lines = source.split(/\r?\n/);
  const functions = [];
  for (let index = 0; index < lines.length; index += 1) {
    const classMatch = lines[index].match(/@GemStoneClass\(\s*(['"])(.*?)\1\s*\)/);
    if (!classMatch) continue;

    let classLine = index + 1;
    while (classLine < lines.length && !/\bclass\s+[A-Za-z_$][A-Za-z0-9_$]*/.test(lines[classLine])) {
      classLine += 1;
    }
    if (classLine >= lines.length) {
      throw new Error(`${sourcePath}:${index + 1}: @GemStoneClass must precede a class declaration.`);
    }

    const className = classMatch[2];
    const body = collectClassBody(lines, classLine, sourcePath);
    functions.push(...scanClassBody(body.lines, className, sourcePath, body.startLine));
    index = body.endLine;
  }
  return functions;
}

function scanImports(source) {
  const imports = new Map();
  const importPattern = /import\s+(type\s+)?([\s\S]*?)\s+from\s*(['"])(.*?)\3\s*;?/g;
  for (const match of source.matchAll(importPattern)) {
    const clause = match[2].trim();
    const from = match[4];
    const namedMatch = clause.match(/\{([\s\S]*?)\}/);
    if (!namedMatch) continue;
    for (const specifier of namedMatch[1].split(",")) {
      const parsed = parseImportSpecifier(specifier);
      if (!parsed) continue;
      if (parsed.importedName !== parsed.localName) continue;
      imports.set(parsed.localName, { from, name: parsed.importedName });
    }
  }
  return imports;
}

function parseImportSpecifier(specifier) {
  let text = stripLineComment(specifier).trim();
  if (!text) return undefined;
  if (text.startsWith("type ")) {
    text = text.slice("type ".length).trim();
  }
  const aliasMatch = text.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (aliasMatch) {
    return { importedName: aliasMatch[1], localName: aliasMatch[2] };
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) return undefined;
  return { importedName: text, localName: text };
}

function collectUsedTypeImports(sourceImports, functions, target) {
  for (const name of collectUsedTypeNames(functions)) {
    const imported = sourceImports.get(name);
    if (imported) {
      addTypeImport(target, imported.from, imported.name);
    }
  }
}

function collectUsedTypeNames(functions) {
  const names = new Set();
  for (const fn of functions) {
    collectTypeNames(fn.sessionType, names);
    collectTypeNames(fn.returnType, names);
    if (Array.isArray(fn.argTypes)) {
      for (const type of fn.argTypes) collectTypeNames(type, names);
    } else if (fn.argTypes && typeof fn.argTypes === "object") {
      for (const type of Object.values(fn.argTypes)) collectTypeNames(type, names);
    }
  }
  return names;
}

function collectTypeNames(type, names) {
  if (!type) return;
  for (const match of String(type).matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)) {
    names.add(match[0]);
  }
}

function addTypeImport(target, from, name) {
  const names = target.get(from) ?? new Set();
  names.add(name);
  target.set(from, names);
}

function renderTypeImports(imports) {
  return Array.from(imports, ([from, names]) => ({
    from,
    typeNames: Array.from(names),
  }));
}

function collectClassBody(lines, classLine, sourcePath) {
  const body = [];
  let depth = 0;
  let sawOpen = false;
  for (let index = classLine; index < lines.length; index += 1) {
    const line = stripLineComment(lines[index]);
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        sawOpen = true;
      } else if (ch === "}") {
        depth -= 1;
      }
    }
    if (sawOpen && index > classLine && depth > 0) {
      body.push(lines[index]);
    }
    if (sawOpen && depth === 0) {
      return { lines: body, startLine: classLine + 2, endLine: index };
    }
  }
  throw new Error(`${sourcePath}:${classLine + 1}: class declaration is missing a closing brace.`);
}

function scanClassBody(lines, className, sourcePath, startLine) {
  const functions = [];
  let pendingSelector;
  for (let offset = 0; offset < lines.length; offset += 1) {
    const line = lines[offset];
    const selectorMatch = line.match(/@GemStoneSelector\(\s*(['"])(.*?)\1\s*\)/);
    if (selectorMatch) {
      pendingSelector = selectorMatch[2];
      continue;
    }

    const methodMatch = line.match(/^\s*(?:static\s+)?(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*(?::\s*([^;{]+))?/);
    if (!methodMatch || methodMatch[1] === "constructor") continue;

    const methodName = methodMatch[1];
    const parameters = parseParameters(methodMatch[2]);
    const session = parameters[0]?.name === "session" ? parameters.shift() : undefined;
    const selector = pendingSelector ?? inferSelectorForSource(methodName, parameters.length, sourcePath, startLine + offset);
    pendingSelector = undefined;
    const returnType = unwrapPromise(methodMatch[3]?.trim());

    const entry = {
      exportedName: methodName,
      className,
      selector,
      argNames: parameters.map((param) => param.name),
    };
    if (parameters.length > 0 && parameters.every((param) => param.type)) {
      entry.argTypes = parameters.map((param) => param.type);
    }
    if (session?.type) {
      entry.sessionType = session.type;
    }
    if (returnType) {
      entry.returnType = returnType;
    }
    functions.push(entry);
  }
  return functions;
}

function parseParameters(source) {
  const trimmed = source.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((part) => {
    const cleaned = part.trim().replace(/=.*$/, "").replace(/^\.\.\./, "");
    const match = cleaned.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\?)?\s*(?::\s*(.+))?$/);
    if (!match) {
      throw new Error(`Unsupported method parameter syntax: ${part.trim()}`);
    }
    return { name: match[1], type: match[2]?.trim() };
  });
}

function unwrapPromise(type) {
  if (!type) return undefined;
  const match = type.match(/^Promise\s*<(.+)>$/);
  return match ? match[1].trim() : type;
}

function inferSelectorForSource(methodName, arity, sourcePath, lineNumber) {
  try {
    return inferSelector(methodName, arity);
  } catch (error) {
    throw new Error(`${sourcePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stripLineComment(line) {
  return line.replace(/\/\/.*$/, "");
}

function parseArgs(args) {
  const sourcePaths = [];
  let outputPath;
  let help = false;
  const extra = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--out") {
      outputPath = args[index + 1];
      index += 1;
      if (!outputPath) extra.push("--out");
    } else if (arg.startsWith("--")) {
      extra.push(arg);
    } else {
      sourcePaths.push(arg);
    }
  }
  return { help, outputPath, sourcePaths, extra };
}

function printUsage(stream) {
  stream.write([
    "Usage: npm run codegen:scan -- [--out manifest.json] <source.ts> [more.ts...]",
    "",
    "Scans @GemStoneClass and @GemStoneSelector decorators and emits a codegen manifest.",
    "Multi-argument methods require @GemStoneSelector because selector inference is ambiguous.",
    "",
  ].join("\n"));
}

function fail(message, showUsage = false) {
  process.stderr.write(`${message}\n`);
  if (showUsage) printUsage(process.stderr);
  process.exit(1);
}
