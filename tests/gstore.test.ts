import assert from "node:assert/strict";
import test from "node:test";
import {
  GStore,
  GStoreAbortTransaction,
  GStoreError,
  GStoreTransaction,
  OOP_NIL,
  Session,
  type Oop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

test("GStore transactions persist JSON values under GStoreRoot", async () => {
  const runtime = newGStoreRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const store = await GStore.open(session, "sample.db");

  const result = await store.transaction((txn) => {
    txn.set("alpha", { name: "Tariq", count: 2 });
    txn.set("beta", ["a", "b"]);
    txn.set("plain", "text");
    return "written";
  });

  assert.equal(result, "written");
  const snapshot = await store.transaction((txn) => {
    assert.equal(txn.has("alpha"), true);
    assert.deepEqual(txn.require("alpha"), { name: "Tariq", count: 2 });
    assert.deepEqual(txn.get("beta"), ["a", "b"]);
    assert.equal(txn.get("missing", "fallback"), "fallback");
    assert.deepEqual(txn.toObject(), {
      alpha: { name: "Tariq", count: 2 },
      beta: ["a", "b"],
      plain: "text",
    });
    return txn.toObject();
  }, { readOnly: true });

  assert.deepEqual(snapshot, {
    alpha: { name: "Tariq", count: 2 },
    beta: ["a", "b"],
    plain: "text",
  });
  assert.deepEqual(await GStore.list(session), ["sample.db"]);
  assert(runtime.calls.some((call) => call.method === "commit"), "write transaction should commit");
  await session.logout();
});

test("GStore buffers deletes and aborts cleanly", async () => {
  const runtime = newGStoreRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const store = await GStore.open(session, "sample.db");
  await store.transaction((txn) => {
    txn.set("keep", true);
    txn.set("drop", false);
  });

  await store.transaction((txn) => {
    assert.equal(txn.delete("drop"), true);
    txn.set("added", 7);
  });
  assert.deepEqual(await store.read(), { keep: true, added: 7 });

  const abortResult = await store.transaction((txn) => {
    txn.set("added", 9);
    throw new GStoreAbortTransaction();
  });
  assert.equal(abortResult, undefined);
  assert.deepEqual(await store.read(), { keep: true, added: 7 });
  await session.logout();
});

test("GStore rejects nested, read-only, closed, and non-JSON writes", async () => {
  const runtime = newGStoreRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const store = await GStore.open(session, "sample.db");

  await assert.rejects(
    () => store.transaction((outer) => store.transaction(() => outer.set("x", 1))),
    /nested transaction/,
  );
  await assert.rejects(
    () => store.transaction((txn) => txn.set("x", 1), { readOnly: true }),
    /read-only/,
  );
  await assert.rejects(
    () => store.transaction((txn) => txn.set("bad", Number.NaN)),
    /JSON-serializable/,
  );
  await assert.rejects(
    () => store.transaction((txn) => txn.set("date", new Date() as never)),
    /JSON-serializable/,
  );

  let captured: GStoreTransaction | undefined;
  await store.transaction((txn) => {
    captured = txn;
  }, { readOnly: true });
  const closed = captured;
  if (!closed) throw new Error("transaction should expose the captured handle");
  assert.throws(() => closed.get("x"), /not open/);
  await session.logout();
});

test("GStore remove helpers delete named stores and root", async () => {
  const runtime = newGStoreRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await (await GStore.open(session, "one.db")).transaction((txn) => txn.set("x", 1));
  await GStore.open(session, "two.db");

  assert.deepEqual(new Set(await GStore.list(session)), new Set(["one.db", "two.db"]));
  assert.equal(await GStore.remove(session, "one.db"), true);
  assert.deepEqual(await GStore.list(session), ["two.db"]);
  assert.equal(await GStore.rm(session, "missing.db"), false);
  assert.equal(await GStore.removeAll(session), true);
  assert.deepEqual(await GStore.list(session), []);
  assert.equal(await GStore.rmAll(session), false);
  await session.logout();
});

test("GStore retries conflict-like commit failures", async () => {
  const runtime = newGStoreRuntime();
  let commitAttempts = 0;
  runtime.commit = async () => {
    runtime.record("commit");
    commitAttempts += 1;
    return commitAttempts > 1;
  };
  runtime.err = async () => {
    runtime.record("err");
    return { number: 240, fatal: false, message: "Commit conflict" };
  };
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const store = await GStore.open(session, "sample.db");

  await store.transaction((txn) => txn.set("alpha", "value"));

  assert.equal(commitAttempts, 2);
  assert.deepEqual(await store.read(), { alpha: "value" });
  await session.logout();
});

test("GStore exhausts conflict retries and preserves hard commit errors", async () => {
  const conflictRuntime = newGStoreRuntime();
  conflictRuntime.commit = async () => {
    conflictRuntime.record("commit");
    return false;
  };
  conflictRuntime.err = async () => {
    conflictRuntime.record("err");
    return { number: 240, fatal: false, message: "Commit conflict" };
  };
  const conflictSession = await Session.connect({ username: "u", password: "p", runtime: conflictRuntime });
  const conflictStore = await GStore.open(conflictSession, "sample.db");
  await assert.rejects(
    () => conflictStore.transaction((txn) => txn.set("alpha", "value"), { maxRetries: 2 }),
    GStoreError,
  );
  await conflictSession.logout();

  const hardRuntime = newGStoreRuntime();
  hardRuntime.commit = async () => {
    hardRuntime.record("commit");
    return false;
  };
  hardRuntime.err = async () => {
    hardRuntime.record("err");
    return { number: 500, fatal: false, message: "GemStone commit failed" };
  };
  const hardSession = await Session.connect({ username: "u", password: "p", runtime: hardRuntime });
  const hardStore = await GStore.open(hardSession, "sample.db");
  await assert.rejects(
    () => hardStore.transaction((txn) => txn.set("alpha", "value")),
    /GemStone commit failed/,
  );
  await hardSession.logout();
});

function newGStoreRuntime(): MockGciRuntime {
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    async execute(source) {
      if (source.includes("keysAndValuesDo:")) {
        const dict = BigInt(source.match(/Object _objectForOop:\s+(\d+)/)?.[1] ?? "0") as Oop;
        return runtime.newString(dictionaryKeys(runtime, dict).join("\n"));
      }
      return OOP_NIL;
    },
  });
  return runtime;
}

function dictionaryKeys(runtime: MockGciRuntime, dict: Oop): string[] {
  const prefix = `${dict.toString()}:`;
  return [...runtime.strKeyDict.keys()]
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .sort();
}
