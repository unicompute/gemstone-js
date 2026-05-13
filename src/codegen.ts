import type { Session } from "./client.ts";

export interface GemStoneClassMetadata {
  className: string;
  target: Function;
  selectors: Map<string | symbol, string>;
}

const classMetadata = new WeakMap<Function, GemStoneClassMetadata>();

export function GemStoneClass(className: string): ClassDecorator {
  return (target) => {
    classMetadata.set(target, {
      className,
      target,
      selectors: new Map(),
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
  args: string[],
): Promise<unknown> {
  const receiver = await session.resolveSymbol(className);
  const oopArgs = await Promise.all(args.map((arg) => session.newString(arg)));
  return session.performValue(receiver, selector, ...oopArgs);
}

export function renderGeneratedFunction(options: {
  exportedName: string;
  className: string;
  selector: string;
  argNames: string[];
}): string {
  const args = options.argNames.join(", ");
  const stringArgs = options.argNames.map((arg) => `await session.newString(${arg})`).join(", ");
  return [
    `export async function ${options.exportedName}(session, ${args}) {`,
    `  const receiver = await session.resolveSymbol(${JSON.stringify(options.className)});`,
    `  return session.perform(receiver, ${JSON.stringify(options.selector)}${stringArgs ? `, ${stringArgs}` : ""});`,
    `}`,
    "",
  ].join("\n");
}
