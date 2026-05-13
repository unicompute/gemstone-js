#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
import {
  inferGeneratedReturnKind,
  inferSelector,
  renderGeneratedModule,
  validateGeneratedModuleOptions,
} from "../src/codegen.ts";

const TYPE_PRINTER = ts.createPrinter({ removeComments: true });

try {
  await main(process.argv.slice(2));
} catch (error) {
  fail(errorMessage(error));
}

async function main(args) {
  const { check, format, help, outputPath, sourcePaths, extra } = parseArgs(args);

  if (help) {
    printUsage(process.stdout);
    return;
  }
  if (extra.length > 0) {
    fail(`Unexpected argument: ${extra[0]}`, true);
  }
  if (sourcePaths.length === 0) {
    fail("Missing TypeScript source path.", true);
  }
  if (check && !outputPath) {
    fail("--check requires --out.", true);
  }

  const functions = [];
  const imports = new Map();
  for (const sourcePath of sourcePaths) {
    const source = await readFile(sourcePath, "utf8");
    const scanned = scanSource(source, sourcePath);
    functions.push(...scanned.functions);
    collectUsedTypeImports(scanImports(source, sourcePath), scanned.usedTypeNames, imports);
  }

  const manifest = {
    $schema: "./schemas/codegen-manifest.schema.json",
    ...(imports.size > 0 ? { imports: renderTypeImports(imports) } : {}),
    functions,
  };
  validateGeneratedModuleOptions(manifest);
  const rendered = format === "module"
    ? renderGeneratedModule(manifest)
    : `${JSON.stringify(manifest, null, 2)}\n`;

  if (check) {
    let existing;
    try {
      existing = await readFile(outputPath, "utf8");
    } catch (error) {
      fail(`Cannot read generated output ${outputPath}: ${errorMessage(error)}`);
    }
    if (existing !== rendered) {
      fail(`Generated ${format} output is out of date: ${outputPath}`);
    }
    process.stdout.write(`Generated ${format} output is up to date: ${outputPath}\n`);
  } else if (outputPath) {
    await writeFile(outputPath, rendered);
  } else {
    process.stdout.write(rendered);
  }
}

function scanSource(source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assertNoParseDiagnostics(sourceFile, sourcePath);
  const decoratorNames = scanDecoratorNames(sourceFile);
  const functions = [];
  const usedTypeNames = new Set();

  function visit(node) {
    if (ts.isClassDeclaration(node)) {
      const className = decoratorStringArg(node, "GemStoneClass", sourceFile, sourcePath, decoratorNames);
      if (className) {
        const implementedMethods = collectImplementedMethodNames(node);
        for (const member of node.members) {
          const entry = scanMethod(member, className, sourceFile, sourcePath, decoratorNames, implementedMethods, usedTypeNames);
          if (entry) functions.push(entry);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { functions, usedTypeNames };
}

function scanImports(source, sourcePath = "source.ts") {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assertNoParseDiagnostics(sourceFile, sourcePath);
  const imports = new Map();
  scanDefaultImports(sourceFile, imports);
  scanNamespaceImports(sourceFile, imports);

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    const from = statement.moduleSpecifier.text;

    for (const specifier of namedBindings.elements) {
      const localName = specifier.name.text;
      const importedName = specifier.propertyName?.text ?? localName;
      imports.set(localName, {
        from,
        name: importedName,
        ...(importedName !== localName ? { alias: localName } : {}),
      });
    }
  }

  return imports;
}

function scanDefaultImports(sourceFile, imports) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const name = statement.importClause?.name?.text;
    if (!name) continue;
    imports.set(name, {
      from: statement.moduleSpecifier.text,
      typeDefaultName: name,
    });
  }
}

function scanNamespaceImports(sourceFile, imports) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamespaceImport(namedBindings)) continue;
    const name = namedBindings.name.text;
    imports.set(name, {
      from: statement.moduleSpecifier.text,
      typeNamespaceName: name,
    });
  }
}

function assertNoParseDiagnostics(sourceFile, sourcePath) {
  const diagnostic = sourceFile.parseDiagnostics[0];
  if (!diagnostic) return;
  const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  throw new Error(`${sourcePath}:${position.line + 1}:${position.character + 1}: TypeScript parse error: ${message}`);
}

function scanDecoratorNames(sourceFile) {
  const names = {
    GemStoneClass: new Set(["GemStoneClass"]),
    GemStoneSelector: new Set(["GemStoneSelector"]),
    namespaces: new Set(),
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "gemstone-js") continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      names.namespaces.add(namedBindings.name.text);
      continue;
    }
    if (!ts.isNamedImports(namedBindings)) continue;
    for (const specifier of namedBindings.elements) {
      const importedName = specifier.propertyName?.text ?? specifier.name.text;
      if (importedName === "GemStoneClass" || importedName === "GemStoneSelector") {
        names[importedName].add(specifier.name.text);
      }
    }
  }

  return names;
}

function collectImplementedMethodNames(classNode) {
  const names = new Set();
  for (const member of classNode.members) {
    if (!ts.isMethodDeclaration(member) || !member.body || !ts.isIdentifier(member.name)) continue;
    names.add(member.name.text);
  }
  return names;
}

function scanMethod(member, className, sourceFile, sourcePath, decoratorNames, implementedMethods, usedTypeNames) {
  if (!ts.isMethodDeclaration(member)) return undefined;
  if (!ts.isIdentifier(member.name)) return undefined;
  if (!member.body && implementedMethods.has(member.name.text)) return undefined;

  const methodName = member.name.text;
  const parameters = parseParameters(member.parameters, sourceFile, sourcePath);
  const session = parameters[0]?.name === "session" ? parameters.shift() : undefined;
  const line = lineNumber(sourceFile, member.name);
  const selector = decoratorStringArg(member, "GemStoneSelector", sourceFile, sourcePath, decoratorNames)
    ?? inferSelectorForSource(methodName, parameters.length, sourcePath, line);
  const returnTypeNode = unwrapPromiseReturnTypeNode(member.type);
  const returnType = returnTypeNode ? typeText(returnTypeNode, sourceFile) : undefined;

  collectTypeNodeNames(session?.typeNode, usedTypeNames);
  for (const parameter of parameters) {
    collectTypeNodeNames(parameter.typeNode, usedTypeNames);
  }
  collectTypeNodeNames(returnTypeNode, usedTypeNames);

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
    const returnKind = inferGeneratedReturnKind(returnType);
    if (returnKind !== "value") {
      entry.returnKind = returnKind;
    }
  }
  return entry;
}

function decoratorStringArg(node, decoratorName, sourceFile, sourcePath, decoratorNames) {
  const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
  const acceptedNames = decoratorNames[decoratorName] ?? new Set([decoratorName]);
  for (const decorator of decorators) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression)) continue;
    if (!isGemStoneDecoratorCall(expression.expression, decoratorName, acceptedNames, decoratorNames.namespaces)) continue;
    const [firstArg] = expression.arguments;
    if (firstArg && (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))) {
      return firstArg.text;
    }
    throw new Error(`${sourcePath}:${lineNumber(sourceFile, decorator)}: @${decoratorName} requires a string literal.`);
  }
  return undefined;
}

function isGemStoneDecoratorCall(callee, decoratorName, acceptedNames, namespaces) {
  if (ts.isIdentifier(callee)) {
    return acceptedNames.has(callee.text);
  }
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text !== decoratorName) return false;
  return ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text);
}

function parseParameters(parameters, sourceFile, sourcePath) {
  const parsed = [];
  for (const parameter of parameters) {
    if (isThisParameter(parameter)) continue;
    if (parameter.dotDotDotToken) {
      throwUnsupportedParameter(sourceFile, sourcePath, parameter, "rest");
    }
    if (parameter.questionToken) {
      throwUnsupportedParameter(sourceFile, sourcePath, parameter, "optional");
    }
    if (parameter.initializer) {
      throwUnsupportedParameter(sourceFile, sourcePath, parameter, "defaulted");
    }
    if (!ts.isIdentifier(parameter.name)) {
      throw new Error(
        `${sourcePath}:${lineNumber(sourceFile, parameter)}: Unsupported method parameter syntax: ${parameter.getText(sourceFile)}`,
      );
    }
    parsed.push({
      name: parameter.name.text,
      type: parameter.type ? typeText(parameter.type, sourceFile) : undefined,
      typeNode: parameter.type,
    });
  }
  return parsed;
}

function throwUnsupportedParameter(sourceFile, sourcePath, parameter, kind) {
  throw new Error(
    `${sourcePath}:${lineNumber(sourceFile, parameter)}: Unsupported ${kind} method parameter syntax: ${parameter.getText(sourceFile)}`,
  );
}

function isThisParameter(parameter) {
  return (
    (ts.isIdentifier(parameter.name) && parameter.name.text === "this")
    || parameter.name.kind === ts.SyntaxKind.ThisKeyword
  );
}

function collectUsedTypeImports(sourceImports, usedTypeNames, target) {
  for (const name of usedTypeNames) {
    const imported = sourceImports.get(name);
    if (imported) {
      if (imported.typeDefaultName) {
        addTypeImport(target, imported.from, { typeDefaultName: imported.typeDefaultName });
      } else if (imported.typeNamespaceName) {
        addTypeImport(target, imported.from, { typeNamespaceName: imported.typeNamespaceName });
      } else {
        addTypeImport(target, imported.from, imported.alias ? { name: imported.name, alias: imported.alias } : imported.name);
      }
    }
  }
}

function addTypeImport(target, from, name) {
  const bucket = target.get(from) ?? {
    typeNames: new Set(),
    typeSpecifiers: new Map(),
    typeDefaultName: undefined,
    typeNamespaceName: undefined,
  };
  if (typeof name === "string") {
    bucket.typeNames.add(name);
  } else if (name.typeDefaultName) {
    if (bucket.typeDefaultName && bucket.typeDefaultName !== name.typeDefaultName) {
      throw new Error(`Cannot merge multiple default type imports from ${from}.`);
    }
    bucket.typeDefaultName = name.typeDefaultName;
  } else if (name.typeNamespaceName) {
    if (bucket.typeNamespaceName && bucket.typeNamespaceName !== name.typeNamespaceName) {
      throw new Error(`Cannot merge multiple namespace type imports from ${from}.`);
    }
    bucket.typeNamespaceName = name.typeNamespaceName;
  } else {
    bucket.typeSpecifiers.set(name.alias ?? name.name, name);
  }
  target.set(from, bucket);
}

function renderTypeImports(imports) {
  return Array.from(imports, ([from, bucket]) => ({
    from,
    ...(bucket.typeDefaultName ? { typeDefaultName: bucket.typeDefaultName } : {}),
    ...(bucket.typeNamespaceName ? { typeNamespaceName: bucket.typeNamespaceName } : {}),
    ...(bucket.typeNames.size > 0 ? { typeNames: Array.from(bucket.typeNames) } : {}),
    ...(bucket.typeSpecifiers.size > 0 ? { typeSpecifiers: Array.from(bucket.typeSpecifiers.values()) } : {}),
  }));
}

function unwrapPromiseReturnTypeNode(typeNode) {
  if (!typeNode) return undefined;
  return promiseTypeArgument(typeNode) ?? typeNode;
}

function promiseTypeArgument(typeNode) {
  let node = typeNode;
  while (ts.isParenthesizedTypeNode(node)) {
    node = node.type;
  }
  if (!ts.isTypeReferenceNode(node)) return undefined;
  if (!isPromiseTypeName(node.typeName)) return undefined;
  if (node.typeArguments?.length !== 1) return undefined;
  return node.typeArguments[0];
}

function isPromiseTypeName(typeName) {
  if (ts.isIdentifier(typeName)) return typeName.text === "Promise";
  return (
    ts.isQualifiedName(typeName)
    && ts.isIdentifier(typeName.left)
    && typeName.left.text === "globalThis"
    && typeName.right.text === "Promise"
  );
}

function collectTypeNodeNames(typeNode, names) {
  if (!typeNode) return;
  visitTypeNode(typeNode);

  function visitTypeNode(node) {
    if (ts.isTypeQueryNode(node)) {
      addEntityNameRoot(node.exprName, names);
      return;
    }
    if (ts.isTypeReferenceNode(node)) {
      addEntityNameRoot(node.typeName, names);
      for (const arg of node.typeArguments ?? []) {
        visitTypeNode(arg);
      }
      return;
    }
    if (ts.isExpressionWithTypeArguments(node)) {
      if (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression)) {
        addExpressionRoot(node.expression, names);
      }
      for (const arg of node.typeArguments ?? []) {
        visitTypeNode(arg);
      }
      return;
    }
    ts.forEachChild(node, visitTypeNode);
  }
}

function addEntityNameRoot(name, names) {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }
  addEntityNameRoot(name.left, names);
}

function addExpressionRoot(expression, names) {
  if (ts.isIdentifier(expression)) {
    names.add(expression.text);
    return;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    addExpressionRoot(expression.expression, names);
  }
}

function typeText(typeNode, sourceFile) {
  return TYPE_PRINTER
    .printNode(ts.EmitHint.Unspecified, typeNode, sourceFile)
    .replace(/\s*\r?\n\s*/g, " ")
    .trim();
}

function inferSelectorForSource(methodName, arity, sourcePath, lineNumber) {
  try {
    return inferSelector(methodName, arity);
  } catch (error) {
    throw new Error(`${sourcePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function lineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function parseArgs(args) {
  const sourcePaths = [];
  let outputPath;
  let check = false;
  let format = "manifest";
  let help = false;
  const extra = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--check") {
      check = true;
    } else if (arg === "--manifest") {
      format = "manifest";
    } else if (arg === "--module") {
      format = "module";
    } else if (arg === "-h" || arg === "--help") {
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
  return { check, format, help, outputPath, sourcePaths, extra };
}

function printUsage(stream) {
  stream.write([
    "Usage: npm run codegen:scan -- [--module|--manifest] [--out output] [--check] <source.ts> [more.ts...]",
    "",
    "Scans @GemStoneClass and @GemStoneSelector decorators and emits a codegen manifest by default.",
    "--module emits generated wrapper source directly.",
    "--check compares --out with scanned output and exits non-zero if stale.",
    "Multi-argument methods require @GemStoneSelector because selector inference is ambiguous.",
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
