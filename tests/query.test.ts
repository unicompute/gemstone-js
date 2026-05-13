import {
  GSCollection,
  OOP_NIL,
  oopToSmallint,
  smallintToOop,
  Session,
  type Oop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

const registeredTests: Array<() => Promise<void>> = [];

test("GSCollection.search unwraps result arrays into typed OOP handles", async () => {
  const arrays = new Map<Oop, Oop[]>();
  let searchResult = OOP_NIL;
  const executeSources: string[] = [];
  const runtime = new MockGciRuntime({
    execute(source) {
      executeSources.push(source);
      return searchResult;
    },
    perform(receiver, selector, args) {
      return performArray(arrays, receiver, selector, args);
    },
  });
  searchResult = runtime.allocate();
  const first = runtime.allocate();
  const second = runtime.allocate();
  arrays.set(searchResult, [first, second]);

  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection<{ name: string }>(session, "Bookings");

  const results = await collection.search("customer.name", "=", "Ada's booking");

  assertEqual(results.length, 2);
  assertEqual(results[0].oop, first);
  assertEqual(results[1].oop, second);
  assert(executeSources[0].includes("each customer name = 'Ada''s booking'"), "search should render escaped Smalltalk literal");

  await Promise.all(results.map((result) => result.release()));
  await session.logout();
});

test("GSCollection.iter yields individual objects from each fetched chunk", async () => {
  const arrays = new Map<Oop, Oop[]>();
  const chunkByOffset = new Map<number, Oop>();
  const runtime = new MockGciRuntime({
    execute(source) {
      const offset = Number(source.match(/copyFrom:\s+(\d+)/)?.[1] ?? 0);
      return chunkByOffset.get(offset) ?? OOP_NIL;
    },
    perform(receiver, selector, args) {
      return performArray(arrays, receiver, selector, args);
    },
  });
  const firstChunk = runtime.allocate();
  const secondChunk = runtime.allocate();
  const first = runtime.allocate();
  const second = runtime.allocate();
  const third = runtime.allocate();
  arrays.set(firstChunk, [first, second]);
  arrays.set(secondChunk, [third]);
  chunkByOffset.set(1, firstChunk);
  chunkByOffset.set(3, secondChunk);

  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection(session, "Bookings");
  const seen: Oop[] = [];

  for await (const item of collection.iter(2)) {
    seen.push(item.oop);
    await item.release();
  }

  assertEqual(seen.join(","), [first, second, third].join(","));
  await session.logout();
});

test("GSCollection rejects unsafe query inputs before rendering Smalltalk", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection(session, "Bookings");

  await assertRejects(() => collection.search("customer; System abortTransaction", "=", "Ada"), RangeError);
  await assertRejects(async () => {
    for await (const _item of collection.iter(0)) {
      throw new Error("iterator should not yield");
    }
  }, RangeError);
  await assertRejects(() => collection.search("customer.name", "=", Number.POSITIVE_INFINITY), RangeError);

  await session.logout();
});

for (const run of registeredTests) {
  await run();
}

function performArray(arrays: Map<Oop, Oop[]>, receiver: Oop, selector: string, args: Oop[]): Oop {
  const values = arrays.get(receiver);
  if (!values) return OOP_NIL;
  if (selector === "size") return smallintToOop(values.length);
  if (selector === "at:") {
    const index = Number(oopToSmallint(args[0]));
    return values[index - 1] ?? OOP_NIL;
  }
  return OOP_NIL;
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

async function assertRejects(fn: () => Promise<unknown>, expected: new (...args: never[]) => Error): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof expected) return;
    throw new Error(`expected ${expected.name}, got ${error instanceof Error ? error.name : String(error)}`);
  }
  throw new Error(`expected ${expected.name}, got no rejection`);
}
