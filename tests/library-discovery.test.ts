import {
  findGciLibraryInDirectory,
  isGciLibraryName,
  resolveGciLibraryPath,
  type GciLibraryDiscoveryHost,
} from "../src/runtime/library-discovery.ts";

const registeredTests: Array<() => Promise<void>> = [];

test("resolveGciLibraryPath honors explicit path and GS_LIB_PATH first", () => {
  const host = hostWith({
    "/gem/lib": ["libgcirpc-3.7.5-64.dylib"],
  });

  assertEqual(resolveGciLibraryPath("/explicit/libgcirpc.dylib", {
    GS_LIB_PATH: "/env/libgcirpc.dylib",
    GS_LIB: "/gem/lib",
  }, host), "/explicit/libgcirpc.dylib");
  assertEqual(resolveGciLibraryPath(undefined, {
    GS_LIB_PATH: " /env/libgcirpc.dylib ",
    GS_LIB: "/gem/lib",
  }, host), "/env/libgcirpc.dylib");
});

test("resolveGciLibraryPath scans GS_LIB and chooses newest sorted libgcirpc file", () => {
  const host = hostWith({
    "/gem/lib": [
      "README.txt",
      "libgcirpc-3.7.4-64.dylib",
      "libgcirpc-3.7.5-64.dylib",
      "libgcits-3.7.5-64.dylib",
    ],
  });

  assertEqual(resolveGciLibraryPath(undefined, { GS_LIB: "/gem/lib" }, host), "/gem/lib/libgcirpc-3.7.5-64.dylib");
});

test("resolveGciLibraryPath scans GEMSTONE lib when GS_LIB is absent", () => {
  const host = hostWith({
    "/opt/GemStone/lib": ["libgcirpc-3.7.5-64.so"],
  });

  assertEqual(resolveGciLibraryPath(undefined, { GEMSTONE: "/opt/GemStone" }, host), "/opt/GemStone/lib/libgcirpc-3.7.5-64.so");
});

test("resolveGciLibraryPath accepts GS_LIB when it already names a library file", () => {
  assertEqual(resolveGciLibraryPath(undefined, { GS_LIB: "/tmp/libgcirpc-3.7.5-64.dll" }), "/tmp/libgcirpc-3.7.5-64.dll");
});

test("findGciLibraryInDirectory ignores unrelated files", () => {
  const host = hostWith({
    "/empty": ["libnotgcirpc.so", "libgcirpc.txt", "gcirpc.so"],
  });

  assertEqual(findGciLibraryInDirectory("/empty", host), undefined);
  assert(isGciLibraryName("libgcirpc-3.7.5-64.so"), "expected .so library name to match");
  assert(isGciLibraryName("libgcirpc-3.7.5-64.dylib"), "expected .dylib library name to match");
  assert(isGciLibraryName("libgcirpc-3.7.5-64.dll"), "expected .dll library name to match");
});

for (const run of registeredTests) {
  await run();
}

function hostWith(entries: Record<string, string[]>): GciLibraryDiscoveryHost {
  return {
    listDir(path) {
      return entries[path] ?? [];
    },
  };
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

function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}
