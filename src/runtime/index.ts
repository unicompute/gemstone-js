import type { GciRuntime } from "../types.ts";

let overrideRuntime: GciRuntime | undefined;
let overrideRuntimeFactory: (() => GciRuntime | Promise<GciRuntime>) | undefined;
let detectedRuntimeFactory: Promise<() => GciRuntime | Promise<GciRuntime>> | undefined;

export function setGciRuntimeForTesting(runtime: GciRuntime | undefined): void {
  overrideRuntime = runtime;
  overrideRuntimeFactory = undefined;
  detectedRuntimeFactory = undefined;
}

export function setGciRuntimeFactoryForTesting(
  factory: (() => GciRuntime | Promise<GciRuntime>) | undefined,
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

export async function createGciRuntime(): Promise<GciRuntime> {
  if (overrideRuntime) return overrideRuntime;
  if (overrideRuntimeFactory) return overrideRuntimeFactory();
  detectedRuntimeFactory ??= detectRuntimeFactory();
  const factory = await detectedRuntimeFactory;
  return factory();
}

async function detectRuntimeFactory(): Promise<() => GciRuntime | Promise<GciRuntime>> {
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
