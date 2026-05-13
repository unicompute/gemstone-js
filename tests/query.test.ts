import {
  GSCollection,
  OOP_FALSE,
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

test("GSCollection.searchOop unwraps result arrays without retaining handles", async () => {
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

  const results = await collection.searchOop("customer.name", "=", "Ada's booking");

  assertEqual(results.join(","), [first, second].join(","));
  assert(executeSources[0].includes("each customer name = 'Ada''s booking'"), "searchOop should render escaped Smalltalk literal");
  assert(!runtime.calls.some((call) => call.method === "addOopToExportSet"), "searchOop should not retain raw handles");
  await session.logout();
});

test("GSCollection all and page helpers unwrap collection arrays", async () => {
  const arrays = new Map<Oop, Oop[]>();
  const arraysBySource = new Map<string, Oop>();
  const executeSources: string[] = [];
  const runtime = new MockGciRuntime({
    execute(source) {
      executeSources.push(source);
      return arraysBySource.get(source) ?? arraysBySource.get("page") ?? OOP_NIL;
    },
    perform(receiver, selector, args) {
      return performArray(arrays, receiver, selector, args);
    },
  });
  const allArray = runtime.allocate();
  const pageArray = runtime.allocate();
  const first = runtime.allocate();
  const second = runtime.allocate();
  const third = runtime.allocate();
  arrays.set(allArray, [first, second, third]);
  arrays.set(pageArray, [second, third]);
  arraysBySource.set("Bookings asArray", allArray);
  arraysBySource.set("page", pageArray);

  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection<{ name: string }>(session, "Bookings");

  const all = await collection.all();
  assertEqual(all.length, 3);
  assertEqual(all[0].oop, first);
  await Promise.all(all.map((item) => item.release()));

  const allRaw = await collection.allOop();
  assertEqual(allRaw.join(","), [first, second, third].join(","));

  const page = await collection.page(2, 2);
  assertEqual(page.length, 2);
  assertEqual(page[0].oop, second);
  await Promise.all(page.map((item) => item.release()));

  const pageRaw = await collection.pageOop(2, 2);
  assertEqual(pageRaw.join(","), [second, third].join(","));
  assertEqual((await collection.pageOop(1, 0)).length, 0);

  assertEqual(executeSources[0], "Bookings asArray");
  assertEqual(executeSources[1], "Bookings asArray");
  assert(executeSources[2].includes("collection copyFrom: 2 to: (3 min: collection size)"), "page should render bounded copy");
  assert(executeSources[3].includes("collection copyFrom: 2 to: (3 min: collection size)"), "pageOop should reuse bounded copy");
  assertEqual(executeSources.length, 4);
  await session.logout();
});

test("GSCollection limit helpers fetch bounded result arrays", async () => {
  const arrays = new Map<Oop, Oop[]>();
  let limitedResult = OOP_NIL;
  const executeSources: string[] = [];
  const runtime = new MockGciRuntime({
    execute(source) {
      executeSources.push(source);
      return limitedResult;
    },
    perform(receiver, selector, args) {
      return performArray(arrays, receiver, selector, args);
    },
  });
  limitedResult = runtime.allocate();
  const first = runtime.allocate();
  const second = runtime.allocate();
  arrays.set(limitedResult, [first, second]);

  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection<{ name: string }>(session, "Bookings");

  const results = await collection.limit("customer.name", "=", "Ada's booking", 2);
  assertEqual(results.length, 2);
  assertEqual(results[0].oop, first);
  assertEqual(results[1].oop, second);
  await Promise.all(results.map((result) => result.release()));

  const rawResults = await collection.takeOop("status", "=", "ready", 2);
  assertEqual(rawResults.join(","), [first, second].join(","));
  assertEqual((await collection.limitOop("status", "=", "ready", 0)).length, 0);

  assert(executeSources[0].includes("OrderedCollection new"), "limit should collect into a bounded result buffer");
  assert(executeSources[0].includes("results size < 2"), "limit should stop collecting after count matches");
  assert(!executeSources[0].includes("select:"), "limit should avoid materializing all selected matches");
  assert(executeSources[1].includes("results size < 2"), "takeOop should reuse the bounded query");
  assertEqual(executeSources.length, 2);
  await session.logout();
});

test("GSCollection first helpers return nullable first matches without array fetches", async () => {
  let first = OOP_NIL;
  const executeResults = [first, OOP_NIL];
  const executeSources: string[] = [];
  const runtime = new MockGciRuntime({
    execute(source) {
      executeSources.push(source);
      return executeResults.shift() ?? OOP_NIL;
    },
  });
  first = runtime.allocate();
  executeResults[0] = first;
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection<{ name: string }>(session, "Bookings");

  const found = await collection.first("customer.name", "=", "Ada's booking");
  if (!found) throw new Error("first should return a typed handle for a matching object");
  assertEqual(found.oop, first);
  await found.release();

  const missing = await collection.firstOop("status", "=", "missing");
  assertEqual(missing, null);

  assert(executeSources[0].includes("collection detect: [:each | (each customer name = 'Ada''s booking')] ifNone: [nil]"), "first should render a detect query");
  assert(executeSources[1].includes("collection detect: [:each | (each status = 'missing')] ifNone: [nil]"), "firstOop should reuse the detect query");
  assert(!runtime.calls.some((call) => call.method === "perform" && call.args[1] === "at:"), "first helpers should not fetch result arrays");
  await session.logout();
});

test("GSCollection count and exists render validated predicates without fetching handles", async () => {
  const executeSources: string[] = [];
  const results = [smallintToOop(3), OOP_FALSE];
  const runtime = new MockGciRuntime({
    execute(source) {
      executeSources.push(source);
      return results.shift() ?? OOP_NIL;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection(session, "Bookings");

  assertEqual(await collection.count("customer.name", "=", "Ada's booking"), 3);
  assertEqual(await collection.exists("status", "=", "missing"), false);

  assert(executeSources[0].includes("count := 0."), "count should initialize a counter");
  assert(executeSources[0].includes("collection do: [:each |"), "count should scan without materializing selected results");
  assert(executeSources[0].includes("(each customer name = 'Ada''s booking') ifTrue: [count := count + 1]"), "count should render escaped Smalltalk predicate");
  assert(!executeSources[0].includes("select:"), "count should avoid materializing selected matches");
  assert(executeSources[1].includes("collection detect: [:each | (each status = 'missing')] ifNone: [nil]"), "exists should early-exit with detect:");
  assert(!executeSources[1].includes("count :="), "exists should not count all matches");
  assert(!runtime.calls.some((call) => call.method === "addOopToExportSet"), "count helpers should not retain object handles");
  await session.logout();
});

test("GSCollection size helpers render collection size without fetching handles", async () => {
  const executeSources: string[] = [];
  const sizes = [2, 0];
  const runtime = new MockGciRuntime({
    execute(source) {
      executeSources.push(source);
      return smallintToOop(sizes.shift() ?? 0);
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection(session, "Bookings");

  assertEqual(await collection.size(), 2);
  assertEqual(await collection.isEmpty(), true);

  assertEqual(executeSources[0], "Bookings size");
  assertEqual(executeSources[1], "Bookings size");
  assert(!runtime.calls.some((call) => call.method === "addOopToExportSet"), "size helpers should not retain object handles");
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

test("GSCollection index helpers render escaped index paths", async () => {
  const executeSources: string[] = [];
  const runtime = new MockGciRuntime({
    execute(source) {
      executeSources.push(source);
      return OOP_NIL;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection(session, "Bookings");

  await collection.createEqualityIndexOn("customer's.name");
  await collection.removeEqualityIndexOn("customer's.name");
  await collection.createIndexOn("status", { kind: "equality" });
  await collection.removeIndex("status");

  assert(executeSources[0].includes("createEqualityIndexOn: 'customer''s.name'"), "create index should escape path literals");
  assert(executeSources[1].includes("removeEqualityIndexOn: 'customer''s.name'"), "remove index should escape path literals");
  assert(executeSources[2].includes("createEqualityIndexOn: 'status'"), "generic create index should use equality selector");
  assert(executeSources[3].includes("removeEqualityIndexOn: 'status'"), "generic remove index should use equality selector");
  await session.logout();
});

test("GSCollection rejects unsafe query inputs before rendering Smalltalk", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new GSCollection(session, "Bookings");

  assertThrows(() => new GSCollection(session, ""));
  assertThrows(() => new GSCollection(session, "Bookings; System abortTransaction"));
  await assertRejects(() => collection.search("customer; System abortTransaction", "=", "Ada"), RangeError);
  await assertRejects(() => collection.count("customer; System abortTransaction", "=", "Ada"), RangeError);
  await assertRejects(() => collection.limit("customer.name", "=", "Ada", -1), RangeError);
  await assertRejects(() => collection.page(0, 1), RangeError);
  await assertRejects(() => collection.page(1, -1), RangeError);
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

function assertThrows(fn: () => unknown): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error("expected function to throw");
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
