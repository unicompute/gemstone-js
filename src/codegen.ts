import type { GemStoneArgument, MarshalledValue, Session } from "./client.ts";

export interface GemStoneClassMetadata {
  className: string;
  target: Function;
  selectors: Map<string | symbol, string>;
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

export async function sendGenerated(
  session: Session,
  className: string,
  selector: string,
  args: readonly GemStoneArgument[] = [],
): Promise<MarshalledValue> {
  const receiver = await session.resolveSymbol(className);
  return session.performValueWith(receiver, selector, ...args);
}

export function renderGeneratedFunction(options: {
  exportedName: string;
  className: string;
  selector: string;
  argNames: string[];
}): string {
  const exportedName = assertIdentifier(options.exportedName, "exportedName");
  const argNames = options.argNames.map((arg) => assertIdentifier(arg, "argName"));
  assertUniqueArgNames(argNames);
  const params = ["session", ...argNames].join(", ");
  const forwardedArgs = argNames.length ? `, ${argNames.join(", ")}` : "";
  return [
    `export async function ${exportedName}(${params}) {`,
    `  const receiver = await session.resolveSymbol(${JSON.stringify(options.className)});`,
    `  return session.performValueWith(receiver, ${JSON.stringify(options.selector)}${forwardedArgs});`,
    `}`,
    "",
  ].join("\n");
}

function assertIdentifier(value: string, field: string): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) || RESERVED_JS_WORDS.has(value)) {
    throw new RangeError(`Generated ${field} must be a valid JavaScript identifier: ${value}`);
  }
  return value;
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
