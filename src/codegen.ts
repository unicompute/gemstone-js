import type { GemStoneArgument, MarshalledValue, Session, TypedOop } from "./client.ts";
import type { Oop } from "./oop.ts";

export type GeneratedReturnKind = "value" | "oop" | "object";

export interface GeneratedImportSpec {
  from: string;
  defaultName?: string;
  namespaceName?: string;
  names?: readonly string[];
  typeNames?: readonly string[];
}

export interface GemStoneClassMetadata {
  className: string;
  target: Function;
  selectors: Map<string | symbol, string>;
}

export interface RenderGeneratedFunctionOptions {
  exportedName: string;
  className: string;
  selector: string;
  argNames: string[];
  argTypes?: readonly string[] | Readonly<Record<string, string>>;
  sessionType?: string;
  returnType?: string;
  returnKind?: GeneratedReturnKind;
}

export interface RenderGeneratedModuleOptions {
  $schema?: string;
  imports?: readonly GeneratedImportSpec[];
  functions: readonly RenderGeneratedFunctionOptions[];
  banner?: string | false;
}

const classMetadata = new WeakMap<Function, GemStoneClassMetadata>();

export function GemStoneClass(className: string): ClassDecorator {
  return (target) => {
    const existing = classMetadata.get(target);
    classMetadata.set(target, {
      className,
      target,
      selectors: existing?.selectors ?? new Map(),
    });
  };
}

export function GemStoneSelector(selector: string): MethodDecorator {
  return (target, propertyKey) => {
    const ctor = typeof target === "function" ? target : target.constructor;
    const metadata = classMetadata.get(ctor) ?? {
      className: ctor.name,
      target: ctor,
      selectors: new Map<string | symbol, string>(),
    };
    metadata.selectors.set(propertyKey, selector);
    classMetadata.set(ctor, metadata);
  };
}

export function metadataFor(target: Function): GemStoneClassMetadata | undefined {
  return classMetadata.get(target);
}

export function inferSelector(methodName: string, arity: number): string {
  if (arity <= 0) return methodName;
  if (arity === 1) return `${methodName}:`;
  throw new Error(
    `Cannot infer Smalltalk selector for ${methodName} with ${arity} arguments. ` +
      "Use @GemStoneSelector(\"keyword:selector:\").",
  );
}

export function sendGenerated(
  session: Session,
  className: string,
  selector: string,
  args?: readonly GemStoneArgument[],
): Promise<MarshalledValue>;
export function sendGenerated(
  session: Session,
  className: string,
  selector: string,
  args: readonly GemStoneArgument[] | undefined,
  returnKind: "value",
): Promise<MarshalledValue>;
export function sendGenerated(
  session: Session,
  className: string,
  selector: string,
  args: readonly GemStoneArgument[] | undefined,
  returnKind: "oop",
): Promise<Oop>;
export function sendGenerated(
  session: Session,
  className: string,
  selector: string,
  args: readonly GemStoneArgument[] | undefined,
  returnKind: "object",
): Promise<TypedOop<unknown>>;
export async function sendGenerated(
  session: Session,
  className: string,
  selector: string,
  args: readonly GemStoneArgument[] = [],
  returnKind: GeneratedReturnKind = "value",
): Promise<MarshalledValue | Oop | TypedOop<unknown>> {
  const kind = assertReturnKind(returnKind);
  className = assertNonEmptyString(className, "className");
  selector = assertSelector(selector);
  if (kind === "object") {
    return session.classRef(className).sendObject(selector, ...args);
  }
  const receiver = await session.resolveSymbol(className);
  if (kind === "oop") {
    return session.performWith(receiver, selector, ...args);
  }
  return session.performValueWith(receiver, selector, ...args);
}

export function renderGeneratedFunction(options: RenderGeneratedFunctionOptions): string {
  validateGeneratedFunctionOptions(options);
  const exportedName = assertIdentifier(options.exportedName, "exportedName");
  const className = assertNonEmptyString(options.className, "className");
  const selector = assertSelector(options.selector);
  const argNames = assertArgNames(options.argNames).map((arg) => assertIdentifier(arg, "argName"));
  const argTypes = normalizeArgTypes(argNames, options.argTypes);
  const sessionType = options.sessionType === undefined ? undefined : assertTypeExpression(options.sessionType, "sessionType");
  const returnType = options.returnType === undefined ? undefined : assertTypeExpression(options.returnType, "returnType");
  const returnKind = assertReturnKind(options.returnKind ?? "value");
  assertUniqueArgNames(argNames);
  assertSelectorArity(selector, argNames);
  const params = [
    sessionType ? `session: ${sessionType}` : "session",
    ...argNames.map((arg, index) => argTypes[index] ? `${arg}: ${argTypes[index]}` : arg),
  ].join(", ");
  const forwardedArgs = argNames.length ? `, ${argNames.join(", ")}` : "";
  const returnAnnotation = returnType ? `: Promise<${returnType}>` : "";

  if (returnKind === "object") {
    return [
      `export async function ${exportedName}(${params})${returnAnnotation} {`,
      `  return session.classRef(${JSON.stringify(className)}).sendObject(${JSON.stringify(selector)}${forwardedArgs});`,
      `}`,
      "",
    ].join("\n");
  }

  const method = returnKind === "oop" ? "performWith" : "performValueWith";
  return [
    `export async function ${exportedName}(${params})${returnAnnotation} {`,
    `  const receiver = await session.resolveSymbol(${JSON.stringify(className)});`,
    `  return session.${method}(receiver, ${JSON.stringify(selector)}${forwardedArgs});`,
    `}`,
    "",
  ].join("\n");
}

export function renderGeneratedModule(options: RenderGeneratedModuleOptions): string {
  validateGeneratedModuleOptions(options);
  const chunks: string[] = [];
  if (options.banner !== false) {
    chunks.push(options.banner ?? "// Generated by gemstone-js codegen. Do not edit.", "");
  }
  const imports = renderGeneratedImports(options.imports ?? []);
  if (imports) {
    chunks.push(imports, "");
  }
  for (const fn of options.functions) {
    chunks.push(renderGeneratedFunction(fn).trimEnd(), "");
  }
  return chunks.join("\n");
}

export function validateGeneratedModuleOptions(options: unknown): asserts options is RenderGeneratedModuleOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new TypeError("Generated module options must be an object.");
  }
  const record = options as { functions?: unknown; imports?: unknown };
  if (!Array.isArray(record.functions)) {
    throw new TypeError("Generated module functions must be an array.");
  }
  if (record.imports !== undefined) assertImportSpecs(record.imports);
  assertUniqueExportedNames(record.functions as readonly RenderGeneratedFunctionOptions[]);
  for (const fn of record.functions) {
    validateGeneratedFunctionOptions(fn);
  }
}

export function validateGeneratedFunctionOptions(value: unknown): asserts value is RenderGeneratedFunctionOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Generated function options must be an object.");
  }
  const options = value as Record<string, unknown>;
  assertIdentifier(options.exportedName, "exportedName");
  assertNonEmptyString(options.className, "className");
  const selector = assertSelector(options.selector);
  const argNames = assertArgNames(options.argNames).map((arg) => assertIdentifier(arg, "argName"));
  assertUniqueArgNames(argNames);
  assertSelectorArity(selector, argNames);
  normalizeArgTypes(argNames, options.argTypes);
  if (options.sessionType !== undefined) assertTypeExpression(options.sessionType, "sessionType");
  if (options.returnType !== undefined) assertTypeExpression(options.returnType, "returnType");
  assertReturnKind(options.returnKind ?? "value");
}

function assertReturnKind(value: unknown): GeneratedReturnKind {
  if (value === "value" || value === "oop" || value === "object") return value;
  throw new RangeError(`Generated return kind must be "value", "oop", or "object": ${String(value)}`);
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Generated ${field} must be a string.`);
  }
  if (value.trim() === "") {
    throw new RangeError(`Generated ${field} must not be empty.`);
  }
  return value;
}

function assertSelector(value: unknown): string {
  const selector = assertNonEmptyString(value, "selector");
  if (!selector.includes(":")) return selector;
  if (!selector.endsWith(":")) {
    throw new RangeError(`Generated keyword selector must end with ":": ${selector}`);
  }
  const keywordParts = selector.slice(0, -1).split(":");
  if (keywordParts.some((part) => part === "")) {
    throw new RangeError(`Generated keyword selector contains an empty keyword part: ${selector}`);
  }
  return selector;
}

function assertIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Generated ${field} must be a string.`);
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) || RESERVED_JS_WORDS.has(value)) {
    throw new RangeError(`Generated ${field} must be a valid JavaScript identifier: ${value}`);
  }
  return value;
}

function assertArgNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Generated function argument names must be an array.");
  }
  return value;
}

function normalizeArgTypes(argNames: readonly string[], value: unknown): Array<string | undefined> {
  if (value === undefined) return argNames.map(() => undefined);
  if (Array.isArray(value)) {
    if (value.length !== argNames.length) {
      throw new RangeError(`Generated argTypes length ${value.length} does not match argNames length ${argNames.length}.`);
    }
    return value.map((type, index) => assertTypeExpression(type, `argTypes[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const argNameSet = new Set(argNames);
    for (const key of Object.keys(record)) {
      if (!argNameSet.has(key)) {
        throw new RangeError(`Generated argTypes contains unknown argument name: ${key}`);
      }
    }
    return argNames.map((arg) => {
      if (!(arg in record)) {
        throw new RangeError(`Generated argTypes is missing argument name: ${arg}`);
      }
      return assertTypeExpression(record[arg], `argTypes.${arg}`);
    });
  }
  throw new TypeError("Generated argTypes must be an array or object.");
}

function assertTypeExpression(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Generated ${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new RangeError(`Generated ${field} must not be empty.`);
  }
  if (/[\r\n;`]/.test(trimmed)) {
    throw new RangeError(`Generated ${field} contains unsupported characters.`);
  }
  return trimmed;
}

function assertImportSpecs(value: unknown): readonly GeneratedImportSpec[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Generated module imports must be an array.");
  }
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new TypeError("Generated module import entries must be objects.");
    }
    const spec = item as GeneratedImportSpec;
    assertNonEmptyString(spec.from, "import from");
    if (spec.defaultName !== undefined) assertIdentifier(spec.defaultName, "import defaultName");
    if (spec.namespaceName !== undefined) assertIdentifier(spec.namespaceName, "import namespaceName");
    assertOptionalIdentifierArray(spec.names, "import names");
    assertOptionalIdentifierArray(spec.typeNames, "import typeNames");
    if (spec.namespaceName && spec.names?.length) {
      throw new RangeError("Generated module import entries cannot combine namespaceName and names.");
    }
    if (!spec.defaultName && !spec.namespaceName && !spec.names?.length && !spec.typeNames?.length) {
      throw new RangeError("Generated module import entries must name at least one import.");
    }
  }
  return value;
}

function assertOptionalIdentifierArray(value: unknown, field: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new TypeError(`Generated ${field} must be an array.`);
  }
  for (const name of value) {
    assertIdentifier(name, field);
  }
}

function assertUniqueArgNames(argNames: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of argNames) {
    if (seen.has(name)) {
      throw new RangeError(`Generated function argument names must be unique: ${name}`);
    }
    seen.add(name);
  }
}

function renderGeneratedImports(imports: readonly GeneratedImportSpec[]): string {
  return imports.map(renderGeneratedImport).filter(Boolean).join("\n");
}

function renderGeneratedImport(spec: GeneratedImportSpec): string {
  const from = JSON.stringify(spec.from);
  const valueParts: string[] = [];
  if (spec.defaultName) valueParts.push(spec.defaultName);
  if (spec.namespaceName) valueParts.push(`* as ${spec.namespaceName}`);
  if (spec.names?.length) valueParts.push(`{ ${spec.names.join(", ")} }`);

  const lines: string[] = [];
  if (valueParts.length) {
    lines.push(`import ${valueParts.join(", ")} from ${from};`);
  }
  if (spec.typeNames?.length) {
    lines.push(`import type { ${spec.typeNames.join(", ")} } from ${from};`);
  }
  return lines.join("\n");
}

function assertUniqueExportedNames(functions: readonly RenderGeneratedFunctionOptions[]): void {
  const seen = new Set<string>();
  for (const fn of functions) {
    const name = assertIdentifier(fn.exportedName, "exportedName");
    if (seen.has(name)) {
      throw new RangeError(`Generated module function names must be unique: ${name}`);
    }
    seen.add(name);
  }
}

function assertSelectorArity(selector: string, argNames: readonly string[]): void {
  const expected = selectorArity(selector);
  if (argNames.length !== expected) {
    throw new RangeError(
      `Generated selector ${selector} expects ${expected} argument${expected === 1 ? "" : "s"}, ` +
        `but ${argNames.length} argument name${argNames.length === 1 ? " was" : "s were"} provided.`,
    );
  }
}

function selectorArity(selector: string): number {
  if (selector.includes(":")) {
    return selector.split(":").length - 1;
  }
  return BINARY_SELECTOR_PATTERN.test(selector) ? 1 : 0;
}

const BINARY_SELECTOR_PATTERN = /^[!%&*+,\-/<=>?@\\~|]+$/;

const RESERVED_JS_WORDS = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);
