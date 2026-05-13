import {
  oop,
  smallintToOop,
  type Oop,
} from "../src/index.ts";

const registeredTests: Array<() => Promise<void>> = [];

test("Deno runtime marshals pointer-buffer GCI calls", async () => {
  const globals = globalThis as {
    Deno?: unknown;
  };
  const previousDeno = globals.Deno;
  let declaredSymbols: Record<string, unknown> | undefined;

  globals.Deno = {
    env: { get: () => undefined },
    dlopen(path: string, symbols: unknown) {
      assertEqual(path, "/tmp/libgcirpc-test.dylib");
      declaredSymbols = symbols as Record<string, unknown>;
      return { symbols: fakeSymbols(), close() {} };
    },
  };

  try {
    const { createDenoRuntime } = await import("../src/runtime/deno.ts");
    const runtime = createDenoRuntime();
    await runtime.init("/tmp/libgcirpc-test.dylib");

    await assertRuntimePointerCalls(runtime);
    assert(declaredSymbols && "GciPerform" in declaredSymbols, "Deno symbols should include GciPerform");
    assert(declaredSymbols && "GciFetchBytes_" in declaredSymbols, "Deno symbols should include GciFetchBytes_");
    assert(declaredSymbols && "GciOopToFlt_" in declaredSymbols, "Deno symbols should include GciOopToFlt_");
  } finally {
    if (previousDeno === undefined) delete globals.Deno;
    else globals.Deno = previousDeno;
  }
});

test("Bun runtime marshals pointer-buffer GCI calls", async () => {
  const globals = globalThis as {
    Bun?: unknown;
    require?: unknown;
  };
  const previousBun = globals.Bun;
  const previousRequire = globals.require;
  let declaredSymbols: Record<string, unknown> | undefined;

  globals.Bun = { env: {} };
  globals.require = (name: string) => {
    if (name === "bun:ffi") {
      return {
        FFIType: fakeBunTypes(),
        dlopen(path: string, symbols: unknown) {
          assertEqual(path, "/tmp/libgcirpc-test.dylib");
          declaredSymbols = symbols as Record<string, unknown>;
          return { symbols: fakeSymbols() };
        },
      };
    }
    if (name === "node:fs") {
      return { readdirSync: () => [] };
    }
    throw new Error(`Unexpected require(${name})`);
  };

  try {
    const { createBunRuntime } = await import("../src/runtime/bun.ts");
    const runtime = createBunRuntime();
    await runtime.init("/tmp/libgcirpc-test.dylib");

    await assertRuntimePointerCalls(runtime);
    assert(declaredSymbols && "GciPerform" in declaredSymbols, "Bun symbols should include GciPerform");
    assert(declaredSymbols && "GciFetchBytes_" in declaredSymbols, "Bun symbols should include GciFetchBytes_");
    assert(declaredSymbols && "GciOopToFlt_" in declaredSymbols, "Bun symbols should include GciOopToFlt_");
  } finally {
    if (previousBun === undefined) delete globals.Bun;
    else globals.Bun = previousBun;
    if (previousRequire === undefined) delete globals.require;
    else globals.require = previousRequire;
  }
});

for (const run of registeredTests) {
  await run();
}

async function assertRuntimePointerCalls(runtime: {
  perform(receiver: Oop, selector: string, args?: Oop[]): Promise<Oop>;
  fetchBytes(value: Oop, start: number, count: number): Promise<Uint8Array>;
  oopToFlt(value: Oop): Promise<number>;
  symDictAt(dict: Oop, key: string): Promise<{ value: Oop; assoc: Oop }>;
  strKeyValueDictAt(dict: Oop, key: string): Promise<Oop>;
}): Promise<void> {
  const performResult = await runtime.perform(oop(100), "at:put:", [smallintToOop(1), smallintToOop(2)]);
  assertEqual(performResult, oop(900));

  const bytes = await runtime.fetchBytes(oop(200), 2, 8);
  assertEqual(new TextDecoder().decode(bytes), "abc");
  await assertRejects(() => runtime.fetchBytes(oop(200), 0, 1), RangeError);
  await assertRejects(() => runtime.fetchBytes(oop(200), 1, -1), RangeError);

  assertEqual(await runtime.oopToFlt(oop(300)), 3.25);
  await assertRejects(() => runtime.oopToFlt(oop(0)), Error);

  const lookup = await runtime.symDictAt(oop(400), "UserGlobals");
  assertEqual(lookup.value, oop(700));
  assertEqual(lookup.assoc, oop(701));
  assertEqual(await runtime.strKeyValueDictAt(oop(500), "name"), oop(800));
}

function fakeSymbols(): Record<string, (...args: unknown[]) => unknown> {
  return {
    GciInit: () => 1,
    GciPerform(receiver, selector, args, count) {
      assertEqual(receiver, oop(100));
      assertEqual(readCString(selector), "at:put:");
      const argBuffer = expectBigUint64Array(args, "perform args");
      assertEqual(count, 2);
      assertEqual(argBuffer[0], smallintToOop(1));
      assertEqual(argBuffer[1], smallintToOop(2));
      return oop(900);
    },
    GciFetchBytes_(value, start, out, count) {
      assertEqual(value, oop(200));
      assertEqual(start, 2);
      assertEqual(count, 8);
      expectUint8Array(out, "fetchBytes out buffer").set(new TextEncoder().encode("abc"));
      return 3;
    },
    GciOopToFlt_(value, out) {
      const floatOut = expectFloat64Array(out, "oopToFlt out buffer");
      if (value === oop(0)) return 0;
      assertEqual(value, oop(300));
      floatOut[0] = 3.25;
      return 1;
    },
    GciSymDictAt(dict, key, valueOut, assocOut) {
      assertEqual(dict, oop(400));
      assertEqual(readCString(key), "UserGlobals");
      expectBigUint64Array(valueOut, "symDictAt value out buffer")[0] = 700n;
      expectBigUint64Array(assocOut, "symDictAt assoc out buffer")[0] = 701n;
    },
    GciStrKeyValueDictAt(dict, key, valueOut) {
      assertEqual(dict, oop(500));
      assertEqual(readCString(key), "name");
      expectBigUint64Array(valueOut, "strKeyValueDictAt out buffer")[0] = 800n;
    },
  };
}

function fakeBunTypes(): Record<string, string> {
  return {
    f64: "f64",
    i32: "i32",
    i64: "i64",
    ptr: "ptr",
    u32: "u32",
    u64: "u64",
    void: "void",
  };
}

function readCString(value: unknown): string {
  if (!(value instanceof Uint8Array)) {
    throw new Error("expected C string buffer");
  }
  const end = value.indexOf(0);
  return new TextDecoder().decode(end === -1 ? value : value.subarray(0, end));
}

function expectBigUint64Array(value: unknown, label: string): BigUint64Array {
  if (!(value instanceof BigUint64Array)) {
    throw new Error(`${label} should be a BigUint64Array`);
  }
  return value;
}

function expectFloat64Array(value: unknown, label: string): Float64Array {
  if (!(value instanceof Float64Array)) {
    throw new Error(`${label} should be a Float64Array`);
  }
  return value;
}

function expectUint8Array(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${label} should be a Uint8Array`);
  }
  return value;
}

function test(name: string, fn: () => void | Promise<void>): void {
  registeredTests.push(async () => {
    try {
      await fn();
    } catch (error) {
      if (error instanceof Error) {
        error.message = `${name}: ${error.message}`;
      }
      throw error;
    }
  });
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function assertRejects(fn: () => Promise<unknown>, expected: new (...args: never[]) => Error): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof expected) return;
    throw new Error(`expected ${expected.name}, got ${error instanceof Error ? error.name : String(error)}`);
  }
  throw new Error(`expected ${expected.name}, got no rejection`);
}
