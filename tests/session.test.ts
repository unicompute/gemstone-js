import {
  OOP_FALSE,
  OOP_NIL,
  GsDict,
  PersistentRoot,
  Session,
  SessionPool,
  setGciRuntimeFactoryForTesting,
  setGciRuntimeForTesting,
  smallintToOop,
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
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const dict = await session.dictionaryToOop({
    name: "Alice",
    retries: 3,
    enabled: true,
  });

  assertEqual(await session.strDictGet(dict, "name"), "Alice");
  assertEqual(await session.strDictGet(dict, "retries"), 3n);
  assertEqual(await session.strDictGet(dict, "enabled"), true);
  assert(runtime.calls.some((call) => call.method === "strKeyValueDictAtPut"), "dictionaryToOop should write string-key entries");

  await session.logout();
});

test("GsDict wraps StringKeyValueDictionary access", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const dict = await GsDict.create(session, { name: "Ada" });
  await dict.set("city", "London");

  assertEqual(await dict.get("name"), "Ada");
  assertEqual(await dict.get("city"), "London");
  assertEqual(await dict.has("missing"), false);
  assertEqual((await dict.pick(["name", "city"])).city, "London");

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
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  await session.globalSet("JsBridgeValue", "ready");

  assertEqual(await session.globalGet("JsBridgeValue"), "ready");
  assert(runtime.calls.some((call) => call.method === "symDictAtObjPut"), "globalSet should write a symbol-keyed global");

  await session.logout();
});

test("PersistentRoot value helpers use session marshalling", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const root = new PersistentRoot(session);

  await root.setValue("PersistentJsValue", { name: "Grace", active: true });
  const dict = await root.getDict("PersistentJsValue");

  if (!dict) throw new Error("PersistentRoot should return a dictionary wrapper");
  assertEqual(await dict.get("name"), "Grace");
  assertEqual(await dict.get("active"), true);

  await session.logout();
});

test("PersistentRoot.list returns root keys from GemStone helper output", async () => {
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    execute(source) {
      assert(source.includes("keysAndValuesDo:"), "list should ask GemStone for root keys");
      return runtime.newString("Alpha\nBeta\n");
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const root = new PersistentRoot(session);

  assertEqual((await root.list()).join(","), "Alpha,Beta");

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
  runtime = new MockGciRuntime({
    async execute(source) {
      assert(source.includes("Object _objectForOop:"), "inspect should use the GemStone object lookup helper");
      return runtime.newString(`${smallintToOop(7).toString()}\nSmallInteger\n7\nagain`);
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const inspection = await session.inspect(smallintToOop(7));

  assertEqual(inspection.oop, smallintToOop(7));
  assertEqual(inspection.class, "SmallInteger");
  assertEqual(inspection.printString, "7\nagain");

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
