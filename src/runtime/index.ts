import type { GciRuntime } from "../types.ts";

let overrideRuntime: GciRuntime | undefined;
type RuntimeFactoryOptions = { nativeSessionWorker?: boolean };
type RuntimeFactory = (options?: RuntimeFactoryOptions) => GciRuntime | Promise<GciRuntime>;
let overrideRuntimeFactory: RuntimeFactory | undefined;
let detectedRuntimeFactory: Promise<RuntimeFactory> | undefined;

export function setGciRuntimeForTesting(runtime: GciRuntime | undefined): void {
  overrideRuntime = runtime;
  overrideRuntimeFactory = undefined;
  detectedRuntimeFactory = undefined;
}

export function setGciRuntimeFactoryForTesting(
  factory: RuntimeFactory | undefined,
): void {
  overrideRuntimeFactory = factory;
  overrideRuntime = undefined;
  detectedRuntimeFactory = undefined;
}

export async function getGciRuntime(): Promise<GciRuntime> {
  if (overrideRuntime) return overrideRuntime;
  if (overrideRuntimeFactory) return overrideRuntimeFactory();
  return createGciRuntime();
}

export async function createGciRuntime(options: RuntimeFactoryOptions = {}): Promise<GciRuntime> {
  if (overrideRuntime) return overrideRuntime;
  if (overrideRuntimeFactory) return overrideRuntimeFactory(options);
  detectedRuntimeFactory ??= detectRuntimeFactory();
  const factory = await detectedRuntimeFactory;
  return factory(options);
}

async function detectRuntimeFactory(): Promise<RuntimeFactory> {
  const globals = globalThis as {
    Deno?: unknown;
    Bun?: unknown;
    process?: { versions?: { node?: string } };
  };
  if (globals.Deno) {
    const module = await import("./deno.ts");
    return module.createDenoRuntime;
  }
  if (globals.Bun) {
    const module = await import("./bun.ts");
    return module.createBunRuntime;
  }
  if (globals.process?.versions?.node) {
    const module = await import("./node.ts");
    return module.createNodeRuntime;
  }
  throw new Error("Unsupported JavaScript runtime. gemstone-js supports Node, Deno, and Bun.");
}
