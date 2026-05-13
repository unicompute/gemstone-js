import {
  OOP_FALSE,
  OOP_NIL,
  GemStoneError,
  GsDict,
  PersistentRoot,
  Session,
  SessionPool,
  setGciRuntimeFactoryForTesting,
  setGciRuntimeForTesting,
  oopToSmallint,
  smallintToOop,
  type Oop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

const registeredTests: Array<() => Promise<void>> = [];

test("Session.connect logs in through the runtime and executes source", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({
    username: "DataCurator",
    password: "swordfish",
    runtime,
  });

  assertEqual(session.sessionId, 1);
  assertEqual(await session.execute("1 + 1"), smallintToOop(2));
  assert(runtime.calls.some((call) => call.method === "setNet"), "connect should call setNet");
  assert(runtime.calls.some((call) => call.method === "loginEx"), "connect should call loginEx");

  await session.logout();
});

test("withTransaction commits on success and aborts on failure", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  assertEqual(await session.withTransaction(() => "sync-result"), "sync-result");
  await session.withTransaction(async () => {
    await session.execute("1 + 1");
  });
  assert(runtime.calls.some((call) => call.method === "commit"), "success should commit");

  await session.withTransaction(async () => {
    throw new Error("boom");
  }).catch(() => undefined);
  assert(runtime.calls.some((call) => call.method === "abort"), "failure should abort");

  await session.logout();
});

test("SessionPool reuses clean sessions", async () => {
  const runtime = new MockGciRuntime();
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({
      username: "u",
      password: "p",
      minSize: 0,
      maxSize: 1,
    });

    const first = await pool.acquire();
    await first.release({ clean: true });
    const second = await pool.acquire();
    assertEqual(first.session, second.session);
    await second.release({ clean: true });
    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("SessionPool aborts dirty sessions before returning them to idle", async () => {
  const runtime = new MockGciRuntime();
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({ username: "u", password: "p", maxSize: 1 });
    const lease = await pool.acquire();

    await lease.release();

    assert(runtime.calls.some((call) => call.method === "abort"), "dirty release should abort before reuse");
    assertEqual(pool.stats().idle, 1);
    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("SessionPool discards sessions that fail reset", async () => {
  const runtime = new MockGciRuntime({
    abortResult: false,
    error: { number: 701, fatal: false, message: "abort failed" },
  });
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({ username: "u", password: "p", maxSize: 1 });
    const lease = await pool.acquire();

    await lease.release();

    assert(runtime.calls.some((call) => call.method === "logout"), "failed reset should discard the session");
    assertEqual(pool.stats().idle, 0);
    assertEqual(pool.stats().evictedTotal, 1);
    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("SessionPool validates explicit validationQuery without requiring an interval", async () => {
  const runtime = new MockGciRuntime();
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({
      username: "u",
      password: "p",
      maxSize: 1,
      validationQuery: "System stoneName",
    });
    const lease = await pool.acquire();

    await lease.release({ clean: true });

    assert(runtime.calls.some((call) => call.method === "executeStr" && call.args[0] === "System stoneName"), "explicit validationQuery should run");
    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("SessionPool validates numeric configuration", () => {
  assertThrows(() => new SessionPool({ maxSize: 0 }));
  assertThrows(() => new SessionPool({ minSize: -1 }));
  assertThrows(() => new SessionPool({ minSize: 2, maxSize: 1 }));
  assertThrows(() => new SessionPool({ idleTimeoutMs: -1 }));
  assertThrows(() => new SessionPool({ acquireTimeoutMs: Number.POSITIVE_INFINITY }));
  assertThrows(() => new SessionPool({ validationIntervalMs: -1 }));
});

test("SessionPool warm is idempotent for target capacity", async () => {
  const runtimes: MockGciRuntime[] = [];
  setGciRuntimeFactoryForTesting(() => {
    const runtime = new MockGciRuntime();
    runtimes.push(runtime);
    return runtime;
  });
  try {
    const pool = new SessionPool({ username: "u", password: "p", minSize: 2, maxSize: 4 });

    assertEqual(await pool.warm(), 2);
    assertEqual(await pool.warm(), 0);
    assertEqual(pool.stats().idle, 2);
    assertEqual(pool.stats().currentCapacity, 2);
    assertEqual(pool.stats().createdTotal, 2);
    assertEqual(runtimes.length, 2);
    await assertRejects(() => pool.warm(-1), RangeError);

    await pool.close();
  } finally {
    setGciRuntimeFactoryForTesting(undefined);
  }
});

test("SessionPool stats report pending acquires", async () => {
  const runtime = new MockGciRuntime();
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({ username: "u", password: "p", maxSize: 1 });
    const first = await pool.acquire();
    const waiting = pool.acquire(undefined);

    assertEqual(pool.stats().pendingAcquires, 1);

    await first.release({ clean: true });
    const second = await waiting;
    assertEqual(pool.stats().pendingAcquires, 0);

    await second.release({ clean: true });
    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("SessionPool.withSession releases successful callbacks", async () => {
  const runtime = new MockGciRuntime();
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({ username: "u", password: "p", maxSize: 1 });

    const used = await pool.withSession(async (session) => {
      await session.execute("1 + 1");
      return session;
    }, { release: { clean: true } });

    assertEqual(pool.stats().idle, 1);
    assert(!runtime.calls.some((call) => call.method === "abort"), "clean successful callback should not abort");
    const lease = await pool.acquire();
    assertEqual(lease.session, used);

    await lease.release({ clean: true });
    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("SessionPool.withSession accepts synchronous callbacks", async () => {
  const runtime = new MockGciRuntime();
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({ username: "u", password: "p", maxSize: 1 });

    const sessionId = await pool.withSession((session) => session.sessionId, { release: { clean: true } });

    assertEqual(sessionId, 1);
    assertEqual(pool.stats().idle, 1);
    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("SessionPool.withSession resets failed callbacks while preserving application errors", async () => {
  const runtime = new MockGciRuntime({
    abortResult: false,
    error: { number: 701, fatal: false, message: "abort failed" },
  });
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({ username: "u", password: "p", maxSize: 1 });
    let thrown: unknown;

    try {
      await pool.withSession(async (session) => {
        await session.execute("1 + 1");
        throw new Error("boom");
      });
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) throw new Error("withSession should rethrow the application error");
    assertEqual(thrown.message, "boom");
    assert(runtime.calls.some((call) => call.method === "abort"), "failed callback should reset the session before reuse");
    assert(runtime.calls.some((call) => call.method === "logout"), "failed reset should discard the session");
    assertEqual(pool.stats().idle, 0);
    assertEqual(pool.stats().evictedTotal, 1);
    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("default Session.connect asks the runtime factory for each session", async () => {
  const runtimes: MockGciRuntime[] = [];
  setGciRuntimeFactoryForTesting(() => {
    const runtime = new MockGciRuntime();
    runtimes.push(runtime);
    return runtime;
  });
  try {
    const first = await Session.connect({ username: "u", password: "p" });
    const second = await Session.connect({ username: "u", password: "p" });

    assertEqual(runtimes.length, 2);
    assert(first.runtime !== second.runtime, "default sessions should not share a runtime wrapper");

    await first.logout();
    await second.logout();
  } finally {
    setGciRuntimeFactoryForTesting(undefined);
  }
});

test("ManagedOop waits for export-set retain before release", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const managed = session.managedOop(smallintToOop(7));

  await managed.release();

  const retainIndex = runtime.calls.findIndex((call) => call.method === "addOopToExportSet");
  const releaseIndex = runtime.calls.findIndex((call) => call.method === "removeOopFromExportSet");
  assert(retainIndex >= 0, "managed OOP should be retained");
  assert(releaseIndex > retainIndex, "managed OOP should be released after retain completes");

  await session.logout();
});

test("Session serializes concurrent GCI calls on one runtime", async () => {
  const events: string[] = [];
  const runtime = new MockGciRuntime({
    async execute(source) {
      events.push(`start:${source}`);
      if (source === "slow") {
        await delay(20);
      }
      events.push(`end:${source}`);
      return smallintToOop(source === "slow" ? 1 : 2);
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });

  await Promise.all([
    session.execute("slow"),
    session.execute("fast"),
  ]);

  assertEqual(events.join(","), "start:slow,end:slow,start:fast,end:fast");
  await session.logout();
});

test("serialized sessions reactivate their GCI session before session-bound calls", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  await session.execute("1 + 1");

  const executeIndex = runtime.calls.findIndex((call) => call.method === "executeStr");
  const activationIndex = runtime.calls.findIndex((call, index) => (
    index < executeIndex && call.method === "setSessionId"
  ));
  assert(activationIndex >= 0, "session-bound calls should reactivate the session id first");

  await session.logout();
});

test("performWith marshals common JavaScript arguments", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  await session.performWith(smallintToOop(99), "demo:with:and:and:", 42, "hello", false, null);

  const perform = runtime.calls.findLast((call) => call.method === "perform");
  if (!perform) throw new Error("performWith should call perform");
  const args = perform.args[2] as unknown[];
  assertEqual(args[0], smallintToOop(42));
  assertEqual(args[2], OOP_FALSE);
  assertEqual(args[3], OOP_NIL);
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "hello"), "strings should be allocated through newString");

  await session.logout();
});

test("performWith marshals bigint as SmallInteger value and non-integer numbers as Float", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  await session.performWith(smallintToOop(99), "demo:with:", 123n, 3.25);

  const perform = runtime.calls.findLast((call) => call.method === "perform");
  if (!perform) throw new Error("performWith should call perform");
  const args = perform.args[2] as unknown[];
  assertEqual(args[0], smallintToOop(123n));
  assert(runtime.calls.some((call) => call.method === "fltToOop" && call.args[0] === 3.25), "non-integer numbers should allocate Float OOPs");

  await session.logout();
});

test("performWith marshals JavaScript arrays as GemStone Arrays", async () => {
  let runtime: MockGciRuntime;
  const allocatedArrays: Oop[] = [];
  runtime = new MockGciRuntime({
    perform(_receiver, selector, args) {
      if (selector === "new:") {
        const array = runtime.allocate();
        allocatedArrays.push(array);
        return array;
      }
      if (selector === "at:put:") return args[1];
      if (selector === "withArray:") return args[0];
      return OOP_NIL;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const arrayOop = await session.performWith(smallintToOop(99), "withArray:", ["Ada", 2, false]);
  const wrapped = await session.array(["wrapped"]);

  assertEqual(arrayOop, allocatedArrays[0]);
  assertEqual(wrapped.oop, allocatedArrays[1]);
  assert(runtime.calls.some((call) => call.method === "resolveSymbol" && call.args[0] === "Array"), "array marshalling should resolve Array");

  const newArrayCalls = runtime.calls.filter((call) => call.method === "perform" && call.args[1] === "new:");
  assertEqual(newArrayCalls.length, 2);
  const firstNewArgs = newArrayCalls[0].args[2] as unknown[];
  assertEqual(firstNewArgs[0], smallintToOop(3));

  const puts = runtime.calls.filter((call) => call.method === "perform" && call.args[1] === "at:put:");
  assertEqual(puts.length, 4);
  const firstPutArgs = puts[0].args[2] as unknown[];
  const secondPutArgs = puts[1].args[2] as unknown[];
  const thirdPutArgs = puts[2].args[2] as unknown[];
  assertEqual(puts[0].args[0], arrayOop);
  assertEqual(firstPutArgs[0], smallintToOop(1));
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "Ada"), "array string entries should be marshalled");
  assertEqual(secondPutArgs[0], smallintToOop(2));
  assertEqual(secondPutArgs[1], smallintToOop(2));
  assertEqual(thirdPutArgs[0], smallintToOop(3));
  assertEqual(thirdPutArgs[1], OOP_FALSE);

  await wrapped.release();
  assert(runtime.calls.some((call) => call.method === "addOopToExportSet" && call.args[0] === wrapped.oop), "Session.array should retain the returned array handle");
  await session.logout();
});

test("arrayOopToValues converts GemStone Arrays back to JavaScript values", async () => {
  const arrays = new Map<Oop, Oop[]>();
  const runtime = new MockGciRuntime({
    perform(receiver, selector, args) {
      const values = arrays.get(receiver);
      if (!values) return OOP_NIL;
      if (selector === "size") return smallintToOop(values.length);
      if (selector === "at:") {
        const index = Number(oopToSmallint(args[0]));
        return values[index - 1] ?? OOP_NIL;
      }
      return OOP_NIL;
    },
  });
  const arrayClass = runtime.classSymbol("Array");
  const array = runtime.allocate();
  const nested = runtime.allocate();
  runtime.classByOop.set(array, arrayClass);
  runtime.classByOop.set(nested, arrayClass);
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const name = await session.newString("Ada");
  arrays.set(nested, [smallintToOop(3), OOP_FALSE]);
  arrays.set(array, [name, smallintToOop(2), OOP_NIL, nested]);

  const values = await session.arrayOopToValues(array);
  assertEqual(values[0], "Ada");
  assertEqual(values[1], 2n);
  assertEqual(values[2], null);
  assert(Array.isArray(values[3]), "nested arrays should be recursively marshalled");
  const nestedValues = values[3] as unknown[];
  assertEqual(nestedValues[0], 3n);
  assertEqual(nestedValues[1], false);

  const wrapped = session.typedOop<unknown[]>(array);
  const wrappedValues = await session.arrayValues(wrapped);
  assertEqual(wrappedValues[0], "Ada");
  await wrapped.release();
  await session.logout();
});

test("arrayOopToValues rejects cyclic GemStone Arrays", async () => {
  const arrays = new Map<Oop, Oop[]>();
  const runtime = new MockGciRuntime({
    perform(receiver, selector, args) {
      const values = arrays.get(receiver);
      if (!values) return OOP_NIL;
      if (selector === "size") return smallintToOop(values.length);
      if (selector === "at:") {
        const index = Number(oopToSmallint(args[0]));
        return values[index - 1] ?? OOP_NIL;
      }
      return OOP_NIL;
    },
  });
  const arrayClass = runtime.classSymbol("Array");
  const array = runtime.allocate();
  runtime.classByOop.set(array, arrayClass);
  arrays.set(array, [array]);
  const session = await Session.connect({ username: "u", password: "p", runtime });

  await assertRejects(() => session.arrayOopToValues(array), GemStoneError);

  await session.logout();
});

test("arrayOopToValues enforces readback depth and item bounds", async () => {
  const arrays = new Map<Oop, Oop[]>();
  const runtime = new MockGciRuntime({
    perform(receiver, selector, args) {
      const values = arrays.get(receiver);
      if (!values) return OOP_NIL;
      if (selector === "size") return smallintToOop(values.length);
      if (selector === "at:") {
        const index = Number(oopToSmallint(args[0]));
        return values[index - 1] ?? OOP_NIL;
      }
      return OOP_NIL;
    },
  });
  const arrayClass = runtime.classSymbol("Array");
  const array = runtime.allocate();
  const nested = runtime.allocate();
  runtime.classByOop.set(array, arrayClass);
  runtime.classByOop.set(nested, arrayClass);
  arrays.set(nested, [smallintToOop(3)]);
  arrays.set(array, [smallintToOop(1), smallintToOop(2), nested]);
  const session = await Session.connect({ username: "u", password: "p", runtime });

  await assertRejects(() => session.arrayOopToValues(array, { maxItems: 2 }), RangeError);
  await assertRejects(() => session.arrayOopToValues(array, { maxTotalItems: 3 }), RangeError);
  await assertRejects(() => session.arrayOopToValues(array, { maxDepth: 1 }), RangeError);
  await assertRejects(() => session.arrayValues(array, { maxDepth: 0 }), RangeError);
  const values = await session.arrayOopToValues(array, { maxDepth: 2, maxItems: 3, maxTotalItems: 4 });
  assertEqual(values.length, 3);

  await session.logout();
});

test("ManagedOop.send marshals JavaScript arguments", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const managed = session.managedOop(smallintToOop(12));

  await managed.sendOop("at:put:", 1, "value");
  await managed.sendValue("yourself");

  const perform = runtime.calls.find((call) => call.method === "perform" && call.args[1] === "at:put:");
  if (!perform) throw new Error("sendOop should call perform");
  const args = perform.args[2] as unknown[];
  assertEqual(args[0], smallintToOop(1));
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "value"), "sendOop should allocate string arguments");

  await managed.release();
  await session.logout();
});

test("Session.performObjectWith wraps object results as retained typed handles", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const child = await session.performObjectWith<{ name: string }>(smallintToOop(99), "childNamed:", "primary");

  assertEqual(child.session, session);
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "primary"), "performObjectWith should marshal arguments");

  await child.release();
  assert(runtime.calls.some((call) => call.method === "addOopToExportSet" && call.args[0] === child.oop), "performObjectWith should retain the returned handle");
  await session.logout();
});

test("ManagedOop.sendObject wraps object results as retained typed handles", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const managed = session.managedOop(runtime.allocate());

  const child = await managed.sendObject<{ name: string }>("childNamed:", "primary");

  assertEqual(child.session, session);
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "primary"), "sendObject should marshal arguments");

  await child.release();
  assert(runtime.calls.some((call) => call.method === "addOopToExportSet" && call.args[0] === child.oop), "sendObject should retain the returned handle");
  await managed.release();
  await session.logout();
});

test("ManagedOop inspect helpers delegate through the retained handle", async () => {
  let runtime: MockGciRuntime;
  let object = OOP_NIL;
  const classOop = smallintToOop(99);
  let executeCount = 0;
  runtime = new MockGciRuntime({
    async execute(source) {
      executeCount += 1;
      assert(source.includes(`Object _objectForOop: ${object.toString()}.`), "inspect should target the managed OOP");
      return runtime.newString([
        object.toString(),
        "Booking",
        "a Booking",
        "--gemstone-js-inspect--",
        `classOop=${classOop.toString()}`,
        "size=0",
        "byteSize=0",
        "classHierarchy=Booking,Object",
        "",
      ].join("\n"));
    },
  });
  object = runtime.allocate();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const managed = session.managedOop(object);

  const inspection = await managed.inspect();

  assertEqual(inspection.oop, object);
  assertEqual(inspection.class, "Booking");
  assertEqual(inspection.printString, "a Booking");
  assertEqual(inspection.classHierarchy?.join(">"), "Booking>Object");
  assertEqual(await managed.printString(), "a Booking");
  assertEqual(executeCount, 2);
  const retainIndex = runtime.calls.findIndex((call) => call.method === "addOopToExportSet" && call.args[0] === object);
  const inspectIndex = runtime.calls.findIndex((call) => call.method === "executeStr");
  assert(retainIndex >= 0, "managed OOP should be retained before inspection");
  assert(inspectIndex > retainIndex, "inspect should wait for export-set retain");

  await managed.release();
  await session.logout();
});

test("Session.classRef exposes explicit class-side sends and typed wrapping", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const bookingClass = session.classRef<{ status: string }>("Booking");

  const classOop = await bookingClass.oop();
  assertEqual(await bookingClass.oop(), classOop);
  const classResolutions = runtime.calls.filter((call) => (
    call.method === "resolveSymbol" && call.args[0] === "Booking"
  ));
  assertEqual(classResolutions.length, 1);

  await bookingClass.sendOop("findById:", "B-1");
  assertEqual(await bookingClass.sendValue("yourself"), classOop);
  const perform = runtime.calls.findLast((call) => call.method === "perform");
  if (!perform) throw new Error("classRef sendOop should call perform");
  assertEqual(perform.args[0], classOop);
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "B-1"), "classRef sendOop should marshal string arguments");

  const wrapped = bookingClass.wrap(smallintToOop(5));
  assertEqual(wrapped.session, session);
  assertEqual(wrapped.oop, smallintToOop(5));
  await wrapped.release();

  const allocated = await bookingClass.new();
  assert(runtime.calls.some((call) => call.method === "newOop" && call.args[0] === classOop), "classRef new should allocate through newOop");
  await allocated.release();

  assertThrows(() => session.classRef("   "));
  assertThrows(() => session.classRef("Booking; System abortTransaction"));
  await session.logout();
});

test("GemStoneClassRef.sendObject wraps class-side object results", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const bookingClass = session.classRef<{ status: string }>("Booking");

  const found = await bookingClass.sendObject("findById:", "B-2");

  assertEqual(found.session, session);
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "B-2"), "classRef sendObject should marshal arguments");

  await found.release();
  assert(runtime.calls.some((call) => call.method === "addOopToExportSet" && call.args[0] === found.oop), "classRef sendObject should retain the returned handle");
  await session.logout();
});

test("Session exposes low-level allocation and fetch helpers", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const classOop = await session.resolveSymbol("Array");

  await session.newOop(classOop);
  await session.fetchClass(classOop);
  await session.fetchSize(classOop);
  await session.fetchBytes(classOop, 1, 4);
  await assertRejects(() => session.fetchBytes(classOop, 0, 1), RangeError);
  await assertRejects(() => session.fetchBytes(classOop, 1, -1), RangeError);

  assert(runtime.calls.some((call) => call.method === "newOop"), "newOop should delegate to the runtime");
  assert(runtime.calls.some((call) => call.method === "fetchClass"), "fetchClass should delegate to the runtime");
  assert(runtime.calls.some((call) => call.method === "fetchSize"), "fetchSize should delegate to the runtime");
  assert(runtime.calls.some((call) => call.method === "fetchBytes"), "fetchBytes should delegate to the runtime");

  await session.logout();
});

test("dictionaryToOop stores and retrieves string-key values", async () => {
  let runtime: MockGciRuntime;
  let dict = OOP_NIL;
  runtime = new MockGciRuntime({
    execute(source) {
      assert(source.includes(`Object _objectForOop: ${dict.toString()}.`), "dictionary readback should render the dictionary OOP");
      assert(source.includes("keysAndValuesDo:"), "dictionary readback should ask GemStone for dictionary keys");
      return runtime.newString("name\nretries\nenabled\n");
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });

  dict = await session.dictionaryToOop({
    name: "Alice",
    retries: 3,
    enabled: true,
  });

  assertEqual(await session.strDictGet(dict, "name"), "Alice");
  assertEqual(await session.strDictGet(dict, "retries"), 3n);
  assertEqual(await session.strDictGet(dict, "enabled"), true);
  const readback = await session.dictionaryOopToObject(dict);
  assertEqual(readback.name, "Alice");
  assertEqual(readback.retries, 3n);
  assertEqual(readback.enabled, true);
  const wrapped = session.typedOop(dict);
  assertEqual((await session.dictionaryValues(wrapped)).name, "Alice");
  await wrapped.release();
  assert(runtime.calls.some((call) => call.method === "strKeyValueDictAtPut"), "dictionaryToOop should write string-key entries");

  await session.logout();
});

test("GsDict wraps StringKeyValueDictionary access", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const dict = await GsDict.create(session, { name: "Ada" });
  const object = runtime.allocate();
  await dict.setAll({ city: "London", enabled: true });
  await dict.setValue("role", "Engineer");
  await dict.setAllValue({ zone: "A1" });
  const nested = (await dict.setAllDict({ nested: { status: "child" } })).nested;
  await dict.setAllOop({ object });

  assertEqual(await dict.get("name"), "Ada");
  assertEqual(await dict.getValue("name"), "Ada");
  assertEqual(await dict.get("city"), "London");
  assertEqual(await dict.getValue("role"), "Engineer");
  assertEqual(await dict.getValue("zone"), "A1");
  assertEqual(await dict.get("enabled"), true);
  assertEqual(await (await dict.getDict("nested"))?.get("status"), "child");
  assertEqual(await (await dict.requireDict("nested")).requireValue("status"), "child");
  assertEqual(nested.oop, await dict.requireOop("nested"));
  assertEqual(await dict.getOop("object"), object);
  assertEqual(await dict.requireValue("name"), "Ada");
  assertEqual(await dict.requireOop("object"), object);
  const required = await dict.require<{ status: string }>("object");
  assertEqual(required.oop, object);
  await required.release();
  assertEqual(await dict.has("missing"), false);
  assertDeepEqual(await dict.hasAll(["name", "missing"]), { name: true, missing: false });
  assertEqual((await dict.pick(["name", "city"])).city, "London");
  assertEqual((await dict.pickOop(["object", "missing"])).object, object);
  assertEqual((await dict.pickOop(["object", "missing"])).missing, null);
  assertEqual(await dict.remove("city"), true);
  assertEqual(await dict.has("city"), false);
  assertDeepEqual(await dict.removeAll(["role", "missing-role"]), { role: true, "missing-role": false });
  assertEqual(await dict.has("role"), false);
  assertDeepEqual(await dict.deleteAll(["zone", "missing-zone"]), { zone: true, "missing-zone": false });
  assertEqual(await dict.has("zone"), false);
  assertEqual(await dict.delete("missing"), false);

  await session.logout();
});

test("GsDict size helpers convert GemStone counts", async () => {
  let size = 2;
  const runtime = new MockGciRuntime({
    perform(_receiver, selector) {
      if (selector === "size") return smallintToOop(size);
      return OOP_NIL;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const dict = new GsDict(session, runtime.allocate());

  assertEqual(await dict.size(), 2);
  assertEqual(await dict.isEmpty(), false);
  size = 0;
  assertEqual(await dict.isEmpty(), true);

  await session.logout();
});

test("GsDict keys and entries list dictionary contents", async () => {
  let runtime: MockGciRuntime;
  let dictOop = OOP_NIL;
  let keyListCalls = 0;
  runtime = new MockGciRuntime({
    execute(source) {
      keyListCalls += 1;
      assert(source.includes(`Object _objectForOop: ${dictOop.toString()}.`), "keys should render the dictionary OOP");
      assert(source.includes("keysAndValuesDo:"), "keys should ask GemStone for dictionary keys");
      return runtime.newString("name\ncity\n");
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const dict = await GsDict.create(session, { name: "Ada", city: "London" });
  dictOop = dict.oop;

  assertEqual((await dict.keys()).join(","), "name,city");
  const entries = await dict.entries();
  assertEqual(entries.name, "Ada");
  assertEqual(entries.city, "London");
  const rawEntries = await dict.entriesOop();
  assertEqual(await session.marshalOop(rawEntries.name ?? OOP_NIL), "Ada");
  assertEqual(await session.marshalOop(rawEntries.city ?? OOP_NIL), "London");
  const object = await dict.toObject();
  assertEqual(object.name, "Ada");
  assertEqual(object.city, "London");
  const values = await dict.values();
  assertEqual(values.join(","), "Ada,London");
  const rawValues = await dict.valuesOop();
  assertEqual(await session.marshalOop(rawValues[0]), "Ada");
  assertEqual(await session.marshalOop(rawValues[1]), "London");
  const items = await dict.items();
  assertEqual(items[0][0], "name");
  assertEqual(items[0][1], "Ada");
  assertEqual(items[1][0], "city");
  assertEqual(items[1][1], "London");
  const rawItems = await dict.itemsOop();
  assertEqual(rawItems[0][0], "name");
  assertEqual(await session.marshalOop(rawItems[0][1]), "Ada");
  assertEqual(rawItems[1][0], "city");
  assertEqual(await session.marshalOop(rawItems[1][1]), "London");
  assertEqual(keyListCalls, 8);

  await session.logout();
});

test("GsDict required helpers expose raw, value, and typed entries", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const dict = await GsDict.create(session, { name: "Ada" });
  const object = runtime.allocate();
  await dict.setOop("object", object);
  await dict.setDict("nested", { status: "child" });

  assertEqual(await dict.requireValue("name"), "Ada");
  assertEqual(await dict.requireOop("object"), object);
  const requiredOops = await dict.requireAllOop(["name", "object"]);
  assertEqual(await session.marshalOop(requiredOops.name), "Ada");
  assertEqual(requiredOops.object, object);
  assertDeepEqual(await dict.requireAllValue(["name"]), { name: "Ada" });
  assertEqual((await dict.requireAllDict(["nested"])).nested.oop, await dict.requireOop("nested"));
  assertEqual(await dict.getObject("missing"), null);
  const pickedObjects = await dict.pickObject<{ name: string }>(["object", "missing"]);
  assertEqual(pickedObjects.object?.oop, object);
  assertEqual(pickedObjects.missing, null);
  await pickedObjects.object?.release();
  const pickedDicts = await dict.pickDict(["nested", "missing"]);
  assertEqual(await pickedDicts.nested?.get("status"), "child");
  assertEqual(pickedDicts.missing, null);

  const nullableObject = await dict.getObject<{ name: string }>("object");
  if (!nullableObject) throw new Error("getObject should return a typed handle for existing entries");
  assertEqual(nullableObject.oop, object);
  await nullableObject.release();

  const requiredObject = await dict.requireObject<{ name: string }>("object");
  assertEqual(requiredObject.oop, object);
  await requiredObject.release();
  const requiredObjects = await dict.requireAllObject<{ name: string }>(["object"]);
  assertEqual(requiredObjects.object.oop, object);
  await requiredObjects.object.release();
  const requiredAliases = await dict.requireAll<{ name: string }>(["object"]);
  assertEqual(requiredAliases.object.oop, object);
  await requiredAliases.object.release();
  assert(runtime.calls.some((call) => call.method === "addOopToExportSet" && call.args[0] === object), "object helpers should retain returned handles");
  await assertRejects(() => dict.requireOop("missing"), Error);
  await assertRejects(() => dict.requireAllOop(["name", "missing"]), Error);

  await session.logout();
});

test("GsDict exposes send and inspect helpers", async () => {
  let runtime: MockGciRuntime;
  let inspectCount = 0;
  let dictOop = OOP_NIL;
  let childOop = OOP_NIL;
  runtime = new MockGciRuntime({
    perform(receiver, selector) {
      if (selector === "yourself") return receiver;
      if (selector === "childNamed:") return childOop;
      return OOP_NIL;
    },
    async execute(source) {
      inspectCount += 1;
      assert(source.includes(`Object _objectForOop: ${dictOop.toString()}.`), "dict inspect should target the dictionary OOP");
      return runtime.newString([
        dictOop.toString(),
        "StringKeyValueDictionary",
        "a StringKeyValueDictionary",
        "--gemstone-js-inspect--",
        "classHierarchy=StringKeyValueDictionary,Object",
        "",
      ].join("\n"));
    },
  });
  dictOop = runtime.allocate();
  childOop = runtime.allocate();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const dict = new GsDict(session, dictOop);

  assertEqual(await dict.sendValue("yourself"), dictOop);
  const child = await dict.sendObject<{ name: string }>("childNamed:", "primary");
  assertEqual(child.oop, childOop);
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "primary"), "sendObject should marshal arguments");

  const inspection = await dict.inspect();
  assertEqual(inspection.oop, dictOop);
  assertEqual(inspection.class, "StringKeyValueDictionary");
  assertEqual(inspection.classHierarchy?.join(">"), "StringKeyValueDictionary>Object");
  assertEqual(await dict.printString(), "a StringKeyValueDictionary");
  assertEqual(inspectCount, 2);

  await child.release();
  assert(runtime.calls.some((call) => call.method === "addOopToExportSet" && call.args[0] === childOop), "sendObject should retain the returned handle");
  await session.logout();
});

test("Session.dictionary creates a GsDict wrapper", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const dict = await session.dictionary({ status: "ready" });

  assertEqual(await dict.get("status"), "ready");
  assertEqual(session.dict(dict.oop).oop, dict.oop);

  await session.logout();
});

test("globalSet and globalGet round-trip through UserGlobals", async () => {
  let runtime: MockGciRuntime;
  let listCalls = 0;
  runtime = new MockGciRuntime({
    execute(source) {
      if (source.includes("UserGlobals keysAndValuesDo:")) {
        listCalls += 1;
        return runtime.newString("JsBridgeValue\nJsBridgeObject\nJsBridgeDict\n");
      }
      return OOP_NIL;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const object = runtime.allocate();

  await session.globalSetAllValue({ JsBridgeValue: "ready" });
  await session.globalSetValue("JsBridgeExtraValue", "extra-ready");
  await session.globalSetAllOop({ JsBridgeObject: object });
  const storedDict = (await session.globalSetAllDict({ JsBridgeDict: { status: "nested" } })).JsBridgeDict;

  assertEqual(await session.globalHas("JsBridgeValue"), true);
  assertDeepEqual(await session.globalHasAll(["JsBridgeValue", "MissingGlobal"]), { JsBridgeValue: true, MissingGlobal: false });
  assertEqual(await session.globalGet("JsBridgeValue"), "ready");
  assertEqual(await session.globalGetValue("JsBridgeExtraValue"), "extra-ready");
  assertEqual(await session.globalGetValue("JsBridgeValue"), "ready");
  assertEqual(await session.globalRequireValue("JsBridgeValue"), "ready");
  assertEqual(await session.globalRequireOop("JsBridgeObject"), object);
  assertDeepEqual(await session.globalRequireAllValue(["JsBridgeValue"]), { JsBridgeValue: "ready" });
  const requiredGlobalOops = await session.globalRequireAllOop(["JsBridgeObject", "JsBridgeDict"]);
  assertEqual(requiredGlobalOops.JsBridgeObject, object);
  assertEqual(requiredGlobalOops.JsBridgeDict, storedDict.oop);
  assertEqual((await session.globalKeys()).join(","), "JsBridgeValue,JsBridgeObject,JsBridgeDict");
  assertEqual((await session.globalPick(["JsBridgeValue", "MissingGlobal"])).JsBridgeValue, "ready");
  const pickedOops = await session.globalPickOop(["JsBridgeObject", "MissingGlobal"]);
  assertEqual(pickedOops.JsBridgeObject, object);
  assertEqual(pickedOops.MissingGlobal, null);
  const pickedObjects = await session.globalPickObject<{ status: string }>(["JsBridgeObject", "MissingGlobal"]);
  assertEqual(pickedObjects.JsBridgeObject?.oop, object);
  assertEqual(pickedObjects.MissingGlobal, null);
  await pickedObjects.JsBridgeObject?.release();
  const pickedDicts = await session.globalPickDict(["JsBridgeDict", "MissingGlobal"]);
  assertEqual(await pickedDicts.JsBridgeDict?.get("status"), "nested");
  assertEqual(pickedDicts.MissingGlobal, null);
  const entries = await session.globalEntries();
  assertEqual(entries.JsBridgeValue, "ready");
  assertEqual(entries.JsBridgeObject, object);
  assertEqual(entries.JsBridgeDict, storedDict.oop);
  const entriesOop = await session.globalEntriesOop();
  assertEqual(await session.marshalOop(entriesOop.JsBridgeValue ?? OOP_NIL), "ready");
  assertEqual(entriesOop.JsBridgeObject, object);
  assertEqual(entriesOop.JsBridgeDict, storedDict.oop);
  const globalValues = await session.globalValues();
  assertEqual(globalValues[0], "ready");
  assertEqual(globalValues[1], object);
  assertEqual(globalValues[2], storedDict.oop);
  const globalItems = await session.globalItems();
  assertEqual(globalItems[0][0], "JsBridgeValue");
  assertEqual(globalItems[0][1], "ready");
  assertEqual(globalItems[1][0], "JsBridgeObject");
  assertEqual(globalItems[1][1], object);
  assertEqual(globalItems[2][0], "JsBridgeDict");
  assertEqual(globalItems[2][1], storedDict.oop);
  const globalValuesOop = await session.globalValuesOop();
  assertEqual(await session.marshalOop(globalValuesOop[0]), "ready");
  assertEqual(globalValuesOop[1], object);
  assertEqual(globalValuesOop[2], storedDict.oop);
  const globalItemsOop = await session.globalItemsOop();
  assertEqual(globalItemsOop[0][0], "JsBridgeValue");
  assertEqual(await session.marshalOop(globalItemsOop[0][1]), "ready");
  assertEqual(globalItemsOop[1][0], "JsBridgeObject");
  assertEqual(globalItemsOop[1][1], object);
  assertEqual(globalItemsOop[2][0], "JsBridgeDict");
  assertEqual(globalItemsOop[2][1], storedDict.oop);
  assertEqual(listCalls, 7);
  const nullableObject = await session.globalGetObject<{ status: string }>("JsBridgeObject");
  if (!nullableObject) throw new Error("globalGetObject should return a typed handle for existing globals");
  assertEqual(nullableObject.oop, object);
  await nullableObject.release();
  const requiredObject = await session.globalRequireObject<{ status: string }>("JsBridgeObject");
  assertEqual(requiredObject.oop, object);
  await requiredObject.release();
  const requiredAlias = await session.globalRequire<{ status: string }>("JsBridgeObject");
  assertEqual(requiredAlias.oop, object);
  await requiredAlias.release();
  const requiredObjects = await session.globalRequireAllObject<{ status: string }>(["JsBridgeObject"]);
  assertEqual(requiredObjects.JsBridgeObject.oop, object);
  await requiredObjects.JsBridgeObject.release();
  const requiredAliases = await session.globalRequireAll<{ status: string }>(["JsBridgeObject"]);
  assertEqual(requiredAliases.JsBridgeObject.oop, object);
  await requiredAliases.JsBridgeObject.release();
  const nullableDict = await session.globalGetDict("JsBridgeDict");
  if (!nullableDict) throw new Error("globalGetDict should return a dictionary wrapper for existing globals");
  assertEqual(await nullableDict.get("status"), "nested");
  const requiredDict = await session.globalRequireDict("JsBridgeDict");
  assertEqual(await requiredDict.get("status"), "nested");
  const requiredDicts = await session.globalRequireAllDict(["JsBridgeDict"]);
  assertEqual(await requiredDicts.JsBridgeDict.get("status"), "nested");
  assert(runtime.calls.some((call) => call.method === "symDictAtObjPut"), "globalSet should write a symbol-keyed global");
  assertDeepEqual(await session.globalRemoveAll(["JsBridgeValue", "JsBridgeObject", "JsBridgeDict", "MissingGlobal"]), {
    JsBridgeValue: true,
    JsBridgeObject: true,
    JsBridgeDict: true,
    MissingGlobal: false,
  });
  assertDeepEqual(await session.globalDeleteAll(["JsBridgeExtraValue", "MissingGlobal"]), {
    JsBridgeExtraValue: true,
    MissingGlobal: false,
  });
  assertEqual(await session.globalGet("JsBridgeValue"), null);
  assertEqual(await session.globalHas("JsBridgeObject"), false);
  assertEqual(await session.globalDelete("JsBridgeValue"), false);
  await assertRejects(() => session.globalRequireOop("JsBridgeValue"), Error);
  await assertRejects(() => session.globalRequireAllOop(["JsBridgeValue", "MissingGlobal"]), Error);

  await session.logout();
});

test("PersistentRoot value helpers use session marshalling", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const root = new PersistentRoot(session);

  await root.setAllValue({
    PersistentJsValue: { name: "Grace", active: true },
    PersistentJsStatus: "ready",
  });
  const dict = await root.getDict("PersistentJsValue");

  if (!dict) throw new Error("PersistentRoot should return a dictionary wrapper");
  assertEqual(await dict.get("name"), "Grace");
  assertEqual(await dict.get("active"), true);
  assertEqual(await root.getValue("PersistentJsStatus"), "ready");

  await session.logout();
});

test("PersistentRoot required helpers expose raw, value, and dictionary entries", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const root = new PersistentRoot(session);
  const object = runtime.allocate();

  await root.setValue("RootStatus", "ready");
  const savedDict = (await root.setAllDict({ RootDict: { name: "Ada" } })).RootDict;
  await root.setAll({ RootObject: object });

  assertEqual(await root.has("RootStatus"), true);
  assertEqual(await root.has("MissingRootEntry"), false);
  assertDeepEqual(await root.hasAll(["RootStatus", "MissingRootEntry"]), { RootStatus: true, MissingRootEntry: false });
  assertEqual(await root.requireValue("RootStatus"), "ready");
  assertEqual(await root.requireOop("RootDict"), savedDict.oop);
  assertDeepEqual(await root.requireAllValue(["RootStatus"]), { RootStatus: "ready" });
  const requiredRootOops = await root.requireAllOop(["RootDict", "RootObject"]);
  assertEqual(requiredRootOops.RootDict, savedDict.oop);
  assertEqual(requiredRootOops.RootObject, object);
  assertEqual(await (await root.requireDict("RootDict")).get("name"), "Ada");
  assertEqual(await (await root.requireAllDict(["RootDict"])).RootDict.get("name"), "Ada");
  const pickedObjects = await root.pickObject<{ status: string }>(["RootObject", "MissingRootEntry"]);
  assertEqual(pickedObjects.RootObject?.oop, object);
  assertEqual(pickedObjects.MissingRootEntry, null);
  await pickedObjects.RootObject?.release();
  const pickedDicts = await root.pickDict(["RootDict", "MissingRootEntry"]);
  assertEqual(await pickedDicts.RootDict?.get("name"), "Ada");
  assertEqual(pickedDicts.MissingRootEntry, null);
  const nullableObject = await root.getObject<{ status: string }>("RootObject");
  if (!nullableObject) throw new Error("getObject should return a typed handle for existing root entries");
  assertEqual(nullableObject.oop, object);
  await nullableObject.release();
  const requiredObject = await root.requireObject<{ status: string }>("RootObject");
  assertEqual(requiredObject.oop, object);
  await requiredObject.release();
  const requiredObjects = await root.requireAllObject<{ status: string }>(["RootObject"]);
  assertEqual(requiredObjects.RootObject.oop, object);
  await requiredObjects.RootObject.release();
  const requiredAliases = await root.requireAll<{ status: string }>(["RootObject"]);
  assertEqual(requiredAliases.RootObject.oop, object);
  await requiredAliases.RootObject.release();
  assertDeepEqual(await root.removeAll(["RootStatus", "MissingRootEntry"]), { RootStatus: true, MissingRootEntry: false });
  assertEqual(await root.has("RootStatus"), false);
  assertDeepEqual(await root.deleteAll(["RootObject", "MissingRootObject"]), { RootObject: true, MissingRootObject: false });

  const required = await root.require("RootDict");
  assertEqual(required.oop, savedDict.oop);
  await required.release();
  await assertRejects(() => root.requireOop("MissingRootEntry"), Error);
  await assertRejects(() => root.requireAllOop(["RootDict", "MissingRootEntry"]), Error);

  await session.logout();
});

test("PersistentRoot pick and entries read root values by listed names", async () => {
  let runtime: MockGciRuntime;
  let listCalls = 0;
  runtime = new MockGciRuntime({
    execute(source) {
      listCalls += 1;
      assert(source.includes("dict := UserGlobals."), "entries should list the validated root global");
      assert(source.includes("keysAndValuesDo:"), "entries should ask GemStone for root keys");
      return runtime.newString("RootStatus\nRootEnabled\n");
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const root = new PersistentRoot(session);

  await root.setValue("RootStatus", "ready");
  await root.setValue("RootEnabled", true);

  const picked = await root.pick(["RootStatus", "MissingRootEntry"]);
  assertEqual(picked.RootStatus, "ready");
  assertEqual(picked.MissingRootEntry, null);
  const pickedOop = await root.pickOop(["RootStatus", "MissingRootEntry"]);
  assertEqual(await session.marshalOop(pickedOop.RootStatus ?? OOP_NIL), "ready");
  assertEqual(pickedOop.MissingRootEntry, null);

  const entries = await root.entries();
  assertEqual(entries.RootStatus, "ready");
  assertEqual(entries.RootEnabled, true);
  const entriesOop = await root.entriesOop();
  assertEqual(await session.marshalOop(entriesOop.RootStatus ?? OOP_NIL), "ready");
  assertEqual(await session.marshalOop(entriesOop.RootEnabled ?? OOP_NIL), true);
  const values = await root.values();
  assertEqual(values.join(","), "ready,true");
  const items = await root.items();
  assertEqual(items[0][0], "RootStatus");
  assertEqual(items[0][1], "ready");
  assertEqual(items[1][0], "RootEnabled");
  assertEqual(items[1][1], true);
  const rawValues = await root.valuesOop();
  assertEqual(await session.marshalOop(rawValues[0]), "ready");
  assertEqual(await session.marshalOop(rawValues[1]), true);
  const rawItems = await root.itemsOop();
  assertEqual(rawItems[0][0], "RootStatus");
  assertEqual(await session.marshalOop(rawItems[0][1]), "ready");
  assertEqual(rawItems[1][0], "RootEnabled");
  assertEqual(await session.marshalOop(rawItems[1][1]), true);
  assertEqual(listCalls, 6);

  await session.logout();
});

test("PersistentRoot.list returns root keys from GemStone helper output", async () => {
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    execute(source) {
      assert(source.includes("dict := UserGlobals."), "list should render the validated root global");
      assert(source.includes("keysAndValuesDo:"), "list should ask GemStone for root keys");
      return runtime.newString("Alpha\nBeta\n");
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const root = new PersistentRoot(session);

  assertEqual((await root.list()).join(","), "Alpha,Beta");
  assertEqual((await root.keys()).join(","), "Alpha,Beta");

  await session.logout();
});

test("PersistentRoot rejects unsafe root names before rendering Smalltalk", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const root = new PersistentRoot(session);

  assertThrows(() => new PersistentRoot(session, ""));
  assertThrows(() => new PersistentRoot(session, "UserGlobals; System abortTransaction"));
  await assertRejects(() => session.globalSet("UserGlobals; System abortTransaction", "bad"), RangeError);
  await assertRejects(() => session.globalGet("UserGlobals; System abortTransaction"), RangeError);
  await assertRejects(() => root.setValue("RootEntry; System abortTransaction", "bad"), RangeError);
  await assertRejects(() => root.getOop("RootEntry; System abortTransaction"), RangeError);

  await session.logout();
});

test("marshalOop converts GemStone strings and symbols to JavaScript strings", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const stringOop = await session.newString("hello λ");
  const symbolOop = await session.newSymbol("ReadyState");

  assertEqual(await session.fetchString(stringOop), "hello λ");
  assertEqual(await session.marshalOop(stringOop), "hello λ");
  assertEqual(await session.marshalOop(symbolOop), "ReadyState");
  assert(runtime.calls.some((call) => call.method === "fetchBytes"), "string marshalling should fetch bytes");

  await session.logout();
});

test("marshalOop converts float OOPs when the runtime supports it", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const floatOop = await session.runtime.fltToOop(3.5);

  assertEqual(await session.marshalOop(floatOop), 3.5);

  await session.logout();
});

test("inspect returns typed class and printString metadata", async () => {
  let runtime: MockGciRuntime;
  const classOop = smallintToOop(99);
  runtime = new MockGciRuntime({
    async execute(source) {
      assert(source.includes("Object _objectForOop:"), "inspect should use the GemStone object lookup helper");
      return runtime.newString([
        smallintToOop(7).toString(),
        "SmallInteger",
        "7",
        "again",
        "--gemstone-js-inspect--",
        `classOop=${classOop.toString()}`,
        "size=0",
        "byteSize=1",
        "classHierarchy=SmallInteger,Integer,Number,Object",
        "slot=value\t42",
        "indexed=1\titem",
        "",
      ].join("\n"));
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const inspection = await session.inspect(smallintToOop(7));

  assertEqual(inspection.oop, smallintToOop(7));
  assertEqual(inspection.class, "SmallInteger");
  assertEqual(inspection.printString, "7\nagain");
  assertEqual(inspection.classOop, classOop);
  assertEqual(inspection.size, 0);
  assertEqual(inspection.byteSize, 1);
  assertEqual(inspection.classHierarchy?.join(">"), "SmallInteger>Integer>Number>Object");
  assertEqual(inspection.slots?.[0]?.name, "value");
  assertEqual(inspection.slots?.[0]?.value, "42");
  assertEqual(inspection.indexedFields?.[0]?.index, 1);
  assertEqual(inspection.indexedFields?.[0]?.value, "item");

  await session.logout();
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

function assertDeepEqual(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`expected ${expectedJson}, got ${actualJson}`);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
