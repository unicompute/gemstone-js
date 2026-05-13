import {
  oop,
  smallintToOop,
  type Oop,
} from "../src/index.ts";
import type { GemStoneNativeError } from "@gemstone-js/native";
import {
  cString,
  decodeGciErrorInfo,
  gciErrorBuffer,
  oopArray,
  oopFrom,
  outOop,
  readCString,
  validateFetchCount,
  validateFetchStart,
} from "../src/runtime/ffi-buffers.ts";

const registeredTests: Array<() => Promise<void>> = [];

type NativeErrorGuard = typeof import("@gemstone-js/native").isGemStoneNativeError;

test("shared FFI buffer helpers encode C strings and OOP buffers", () => {
  const encoded = cString("hello");
  assertEqual(encoded[encoded.length - 1], 0);
  assertEqual(readCString(encoded), "hello");
  assertEqual(readCString(new Uint8Array([65, 0, 66])), "A");

  const args = oopArray([smallintToOop(-1), oop("18446744073709551615")]);
  assertEqual(args[0], 18446744073709551610n);
  assertEqual(args[1], 18446744073709551615n);
  assertEqual(outOop().length, 1);
  assertEqual(oopFrom("20"), oop(20));

  assertEqual(validateFetchStart(1), 1);
  assertEqual(validateFetchCount(0), 0);
  assertThrows(() => validateFetchStart(0), RangeError);
  assertThrows(() => validateFetchCount(-1), RangeError);
  assertThrows(() => oopFrom({}), TypeError);
});

test("shared FFI buffer helpers decode GciErr payloads", () => {
  const empty = gciErrorBuffer();
  assertEqual(decodeGciErrorInfo(empty, 0), null);

  const buffer = gciErrorBuffer();
  writeFakeGciErr(buffer);
  const info = decodeGciErrorInfo(buffer, 1);
  if (!info) throw new Error("expected decoded GciErr payload");

  assertEqual(info.category, oop(1000));
  assertEqual(info.context, oop(1001));
  assertEqual(info.exceptionObj, oop(1002));
  assertEqual(info.args?.length, 2);
  assertEqual(info.args?.[0], oop(1003));
  assertEqual(info.args?.[1], oop(1004));
  assertEqual(info.number, 2406);
  assertEqual(info.fatal, true);
  assertEqual(info.message, "message text");
  assertEqual(info.reason, "reason text");
});

test("ambient native module exposes the mapped error type guard", () => {
  const guard: NativeErrorGuard = (error: unknown): error is GemStoneNativeError => (
    Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "GEMSTONE_GCI_ERROR")
  );
  const value: unknown = {
    code: "GEMSTONE_GCI_ERROR",
    operation: "init",
    gciNumber: 404,
  };

  assert(guard(value), "native mapped error guard should narrow the error shape");
  assertEqual(value.operation, "init");
  assertEqual(value.gciNumber, 404);
});

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
    assert(declaredSymbols && "GciErr" in declaredSymbols, "Deno symbols should include GciErr");
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
    assert(declaredSymbols && "GciErr" in declaredSymbols, "Bun symbols should include GciErr");
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
  err(): Promise<{
    number: number;
    fatal: boolean;
    message: string;
    reason?: string;
    args?: Oop[];
  } | null>;
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

  const info = await runtime.err();
  if (!info) throw new Error("err should decode fake GciErr payload");
  assertEqual(info.number, 2406);
  assertEqual(info.fatal, true);
  assertEqual(info.message, "message text");
  assertEqual(info.reason, "reason text");
  assertEqual(info.args?.[0], oop(1003));

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
      assertEqual(readFakeCString(selector), "at:put:");
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
    GciErr(out) {
      writeFakeGciErr(expectUint8Array(out, "GciErr out buffer"));
      return 1;
    },
    GciSymDictAt(dict, key, valueOut, assocOut) {
      assertEqual(dict, oop(400));
      assertEqual(readFakeCString(key), "UserGlobals");
      expectBigUint64Array(valueOut, "symDictAt value out buffer")[0] = 700n;
      expectBigUint64Array(assocOut, "symDictAt assoc out buffer")[0] = 701n;
    },
    GciStrKeyValueDictAt(dict, key, valueOut) {
      assertEqual(dict, oop(500));
      assertEqual(readFakeCString(key), "name");
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

function readFakeCString(value: unknown): string {
  return readCString(expectUint8Array(value, "C string buffer"));
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

function writeFakeGciErr(buffer: Uint8Array): void {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setBigUint64(0, oop(1000), true);
  view.setBigUint64(8, oop(1001), true);
  view.setBigUint64(16, oop(1002), true);
  view.setBigUint64(24, oop(1003), true);
  view.setBigUint64(32, oop(1004), true);
  view.setInt32(104, 2406, true);
  view.setInt32(108, 2, true);
  buffer[112] = 1;
  writeCString(buffer, 113, "message text");
  writeCString(buffer, 1138, "reason text");
}

function writeCString(buffer: Uint8Array, offset: number, value: string): void {
  buffer.set(new TextEncoder().encode(value), offset);
  buffer[offset + value.length] = 0;
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

function assertThrows(fn: () => unknown, expected: new (...args: never[]) => Error): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof expected) return;
    throw new Error(`expected ${expected.name}, got ${error instanceof Error ? error.name : String(error)}`);
  }
  throw new Error(`expected ${expected.name}, got no rejection`);
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
