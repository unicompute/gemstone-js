import {
  OOP_FALSE,
  OOP_NIL,
  OOP_TRUE,
  charToOop,
  isChar,
  isNil,
  isSmallint,
  oopToBool,
  oopToChar,
  oopToHex,
  oopToSmallint,
  smallintToOop,
} from "../src/index.ts";

const registeredTests: Array<() => Promise<void>> = [];

test("smallint helpers round-trip signed values", () => {
  for (const value of [-42n, -1n, 0n, 1n, 42n]) {
    const encoded = smallintToOop(value);
    assert(isSmallint(encoded), `${value} should encode as a SmallInteger`);
    assertEqual(oopToSmallint(encoded), value);
  }
});

test("special OOP helpers identify nil and booleans", () => {
  assert(isNil(OOP_NIL), "nil should be nil");
  assertEqual(oopToBool(OOP_TRUE), true);
  assertEqual(oopToBool(OOP_FALSE), false);
});

test("character helpers round-trip Unicode scalar values", () => {
  for (const value of ["A", "\0", "λ"]) {
    const encoded = charToOop(value);
    assert(isChar(encoded), `${oopToHex(encoded)} should be a Character OOP`);
    assertEqual(oopToChar(encoded), value);
  }
});

for (const run of registeredTests) {
  await run();
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
