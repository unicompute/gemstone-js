import {
  OOP_FALSE,
  OOP_NIL,
  OOP_TRUE,
  RCCounter,
  RCHash,
  RCQueue,
  Session,
  oop,
  oopToSmallint,
  smallintToOop,
  type Oop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

const registeredTests: Array<() => Promise<void>> = [];

test("RcCounter mirrors reduced-conflict counter selectors", async () => {
  const fixture = newReducedConflictFixture();
  const session = await Session.connect({ username: "u", password: "p", runtime: fixture.runtime });

  const counter = await session.rcCounter();
  assertEqual(await counter.value(), 0n);

  await counter.increment();
  await counter.incrementBy(4);
  await counter.decrement();
  await counter.decrementBy(2);
  assertEqual(await counter.value(), 2n);

  let fired = false;
  await counter.incrementBy(8);
  await counter.decrementBy(3, { ifLessThan: 8, onLessThan: () => { fired = true; } });
  assertEqual(fired, true);
  assertEqual(await counter.value(), 7n);

  await counter.decrementIfNegative(5);
  assertEqual(await counter.value(), 7n);

  const alias = session.wrapRcCounter(counter.oop);
  assertEqual(await alias.value(), 7n);
  assertEqual(await RCCounter.wrap(session, counter.oop).value(), 7n);
  assert(fixture.executeSources.some((source) => source.includes("decrementBy: 3")), "guarded decrement should render decrement source");
  assert(fixture.runtime.calls.some((call) => call.method === "perform" && call.args[1] === "incrementBy:"), "incrementBy should send the GemStone selector");

  await session.logout();
});

test("RcKeyValueDictionary wraps reduced-conflict dictionary access", async () => {
  const fixture = newReducedConflictFixture();
  const session = await Session.connect({ username: "u", password: "p", runtime: fixture.runtime });

  const dict = await session.rcKeyValueDictionary();
  await dict.set("name", "Ada");
  await dict.set("age", 42);
  await dict.setOop("raw", smallintToOop(99));
  await dict.setAll({ city: "London" });
  await dict.setAll([["score", 10]]);
  await dict.setAllOop({ rawScore: smallintToOop(11) });

  assertEqual(await dict.get("name"), "Ada");
  assertEqual(await dict.get("missing", "fallback"), "fallback");
  assertEqual(await dict.has("age"), true);
  assertEqual(await dict.has("missing"), false);
  assertEqual(await dict.size(), 6);
  assertEqual(await dict.isEmpty(), false);

  const rawName = await dict.getOop("name");
  if (rawName === null) throw new Error("getOop should return the stored string OOP");
  const nameObject = await dict.getObject("name");
  if (!nameObject) throw new Error("getObject should retain the stored OOP");
  assertEqual(nameObject.oop, rawName);
  await nameObject.release();

  assertDeepEqual(await dict.keys(), ["name", "age", "raw", "city", "score", "rawScore"]);
  assertDeepEqual(await dict.values(), ["Ada", 42n, 99n, "London", 10n, 11n]);
  assertDeepEqual(await dict.items(), [
    ["name", "Ada"],
    ["age", 42n],
    ["raw", 99n],
    ["city", "London"],
    ["score", 10n],
    ["rawScore", 11n],
  ]);
  const londonOop = fixture.runtime.strings.get("London");
  if (!londonOop) throw new Error("London string OOP should be allocated");
  assertDeepEqual((await dict.valuesOop()).map((value) => value.toString()), [
    rawName.toString(),
    smallintToOop(42).toString(),
    smallintToOop(99).toString(),
    londonOop.toString(),
    smallintToOop(10).toString(),
    smallintToOop(11).toString(),
  ]);

  await dict.rebuildTable(17);
  assertEqual(await dict.remove("age"), true);
  assertEqual(await dict.remove("age"), false);
  assertEqual(await dict.size(), 5);

  const alias = session.wrapRcKeyValueDictionary(dict.oop);
  assertEqual(await alias.get("raw"), 99n);
  assertEqual(await RCHash.wrap(session, dict.oop).get("raw"), 99n);
  assert(fixture.executeSources.some((source) => source.includes("associationsDo:")), "itemsOop should enumerate associations in GemStone");
  assert(fixture.runtime.calls.some((call) => call.method === "perform" && call.args[1] === "rebuildTable:"), "rebuildTable should send the GemStone selector");

  await session.logout();
});

test("RcQueue exposes queue aliases, indexed reads, and raw OOP variants", async () => {
  const fixture = newReducedConflictFixture();
  const session = await Session.connect({ username: "u", password: "p", runtime: fixture.runtime });

  const queue = await session.rcQueue();
  assertEqual(await queue.isEmpty(), true);

  await queue.push("first");
  await queue.add(2);
  await queue.enq(false);
  await queue.pushAll(["fourth", 5]);

  assertEqual(await queue.size(), 5);
  assertEqual(await queue.first(), "first");
  assertEqual(await queue.peek(), "first");
  assertEqual(await queue.at(2), 2n);
  assertDeepEqual(await queue.items(), ["first", 2n, false, "fourth", 5n]);

  const firstOop = await queue.firstOop();
  assertEqual(await session.marshalOop(firstOop), "first");
  assertEqual(await queue.pop(), "first");
  assertEqual(await queue.shift(), 2n);
  assertEqual(await queue.deq(), false);
  assertEqual(await queue.pop(), "fourth");
  assertEqual(await queue.pop(), 5n);
  assertEqual(await queue.pop(), null);

  await queue.pushAllOop([smallintToOop(9), smallintToOop(10)]);
  assertEqual(await queue.first(), 9n);
  await queue.clear();
  assertEqual(await queue.isEmpty(), true);

  const alias = session.wrapRcQueue(queue.oop);
  assertEqual(await alias.size(), 0);
  assertEqual(await RCQueue.wrap(session, queue.oop).size(), 0);
  assert(fixture.runtime.calls.some((call) => call.method === "perform" && call.args[1] === "removeAll"), "clear should send removeAll");

  await session.logout();
});

for (const run of registeredTests) {
  await run();
}

function newReducedConflictFixture(): {
  runtime: MockGciRuntime;
  executeSources: string[];
} {
  const executeSources: string[] = [];
  const counters = new Map<Oop, bigint>();
  const dictionaries = new Map<Oop, Map<string, { key: Oop; value: Oop }>>();
  const queues = new Map<Oop, Oop[]>();
  let runtime: MockGciRuntime;

  runtime = new MockGciRuntime({
    async execute(source) {
      executeSources.push(source);
      const objectOop = objectOopFromSource(source);
      if (source.includes("decrementBy:") && source.includes("ifLessThan:")) {
        const counter = objectOop;
        const amount = BigInt(requiredMatch(source, /decrementBy:\s*(-?\d+)/, "decrement amount"));
        const guard = BigInt(requiredMatch(source, /ifLessThan:\s*(-?\d+)/, "decrement guard"));
        const next = (counters.get(counter) ?? 0n) - amount;
        counters.set(counter, next);
        return next < guard ? OOP_TRUE : OOP_FALSE;
      }
      if (source.includes("associationsDo:")) {
        const dictionary = dictionaries.get(objectOop) ?? new Map<string, { key: Oop; value: Oop }>();
        const rows = [...dictionary.values()].map(({ key, value }) => `${key.toString()}|${value.toString()}`).join("\n");
        return runtime.newString(rows.length === 0 ? "" : `${rows}\n`);
      }
      return OOP_NIL;
    },
    perform(receiver, selector, args) {
      if (selector === "new" && receiver === runtime.symbols.get("RcCounter")) {
        const counter = runtime.allocate();
        counters.set(counter, 0n);
        return counter;
      }
      if (selector === "new" && receiver === runtime.symbols.get("RcKeyValueDictionary")) {
        const dictionary = runtime.allocate();
        dictionaries.set(dictionary, new Map<string, { key: Oop; value: Oop }>());
        return dictionary;
      }
      if (selector === "new" && receiver === runtime.symbols.get("RcQueue")) {
        const queue = runtime.allocate();
        queues.set(queue, []);
        return queue;
      }

      const counter = counters.get(receiver);
      if (counter !== undefined) {
        if (selector === "value") return smallintToOop(counter);
        if (selector === "increment") {
          counters.set(receiver, counter + 1n);
          return receiver;
        }
        if (selector === "incrementBy:") {
          counters.set(receiver, counter + oopToSmallint(args[0]));
          return receiver;
        }
        if (selector === "decrement") {
          counters.set(receiver, counter - 1n);
          return receiver;
        }
        if (selector === "decrementBy:") {
          counters.set(receiver, counter - oopToSmallint(args[0]));
          return receiver;
        }
        if (selector === "decrementIfNegative:") {
          if (counter < 0n) counters.set(receiver, counter - oopToSmallint(args[0]));
          return receiver;
        }
      }

      const dictionary = dictionaries.get(receiver);
      if (dictionary) {
        if (selector === "at:put:") {
          dictionary.set(entryKey(args[0]), { key: args[0], value: args[1] });
          return args[1];
        }
        if (selector === "at:otherwise:") {
          return dictionary.get(entryKey(args[0]))?.value ?? args[1];
        }
        if (selector === "includesKey:") {
          return dictionary.has(entryKey(args[0])) ? OOP_TRUE : OOP_FALSE;
        }
        if (selector === "removeKey:ifAbsent:") {
          const key = entryKey(args[0]);
          const value = dictionary.get(key)?.value ?? args[1];
          dictionary.delete(key);
          return value;
        }
        if (selector === "size") return smallintToOop(dictionary.size);
        if (selector === "isEmpty") return dictionary.size === 0 ? OOP_TRUE : OOP_FALSE;
        if (selector === "rebuildTable:") return receiver;
      }

      const queue = queues.get(receiver);
      if (queue) {
        if (selector === "add:") {
          queue.push(args[0]);
          return receiver;
        }
        if (selector === "remove") return queue.shift() ?? OOP_NIL;
        if (selector === "peek") return queue[0] ?? OOP_NIL;
        if (selector === "at:") return queue[Number(oopToSmallint(args[0])) - 1] ?? OOP_NIL;
        if (selector === "size") return smallintToOop(queue.length);
        if (selector === "isEmpty") return queue.length === 0 ? OOP_TRUE : OOP_FALSE;
        if (selector === "removeAll") {
          queue.length = 0;
          return receiver;
        }
      }

      return OOP_NIL;
    },
  });

  return { runtime, executeSources };
}

function entryKey(value: Oop): string {
  return value.toString();
}

function objectOopFromSource(source: string): Oop {
  return oop(requiredMatch(source, /Object _objectForOop:\s*(\d+)/, "object OOP"));
}

function requiredMatch(source: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(source);
  if (!match) throw new Error(`missing ${label} in source: ${source}`);
  return match[1];
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

function assertDeepEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual, jsonReplacer);
  const expectedJson = JSON.stringify(expected, jsonReplacer);
  if (actualJson !== expectedJson) {
    throw new Error(`expected ${expectedJson}, got ${actualJson}`);
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `${value.toString()}n` : value;
}
