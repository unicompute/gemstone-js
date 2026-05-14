import assert from "node:assert/strict";
import test from "node:test";

import {
  RequestScope,
  Session,
  SessionPool,
  TransactionScope,
  requestFailed,
  setGciRuntimeForTesting,
  withSessionScope,
  type TransactionSession,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

test("requestFailed follows error and server status policy", () => {
  assert.equal(requestFailed(), false);
  assert.equal(requestFailed({ responseStatus: 499 }), false);
  assert.equal(requestFailed({ responseStatus: 500 }), true);
  assert.equal(requestFailed({ responseStatus: 400, serverErrorStatus: 400 }), true);
  assert.equal(requestFailed({ error: new Error("boom"), responseStatus: 200 }), true);
});

test("TransactionScope commits, aborts, and reports manual finalization", async () => {
  const committed = new FakeTransactionSession();
  assert.deepEqual(await new TransactionScope(committed).finalize(), {
    action: "commit",
    clean: true,
    discard: false,
  });
  assert.deepEqual(committed.calls, ["commit"]);

  const aborted = new FakeTransactionSession();
  assert.deepEqual(await new TransactionScope(aborted).finalize(new Error("boom")), {
    action: "abort",
    clean: true,
    discard: false,
  });
  assert.deepEqual(aborted.calls, ["abort"]);

  const manual = new FakeTransactionSession();
  assert.deepEqual(await new TransactionScope(manual, { transactionPolicy: "manual" }).finalize(), {
    action: "none",
    clean: false,
    discard: false,
  });
  assert.deepEqual(manual.calls, []);
});

test("TransactionScope aborts after failed commits and marks discard when cleanup fails", async () => {
  const recoverable = new FakeTransactionSession({ commitError: new Error("commit failed") });
  const recoverableScope = new TransactionScope(recoverable);
  await assert.rejects(() => recoverableScope.finalize(), /commit failed/);
  assert.deepEqual(recoverable.calls, ["commit", "abort"]);
  assert.deepEqual(recoverableScope.lastOutcome, {
    action: "abort_after_commit_failed",
    clean: true,
    discard: false,
  });

  const broken = new FakeTransactionSession({
    commitError: new Error("commit failed"),
    abortError: new Error("abort failed"),
  });
  const brokenScope = new TransactionScope(broken);
  await assert.rejects(() => brokenScope.finalize(), /commit failed/);
  assert.deepEqual(broken.calls, ["commit", "abort"]);
  assert.deepEqual(brokenScope.lastOutcome, {
    action: "abort_after_commit_failed",
    clean: false,
    discard: true,
  });
});

test("RequestScope lazily acquires pooled sessions and releases clean commits", async () => {
  const runtime = new MockGciRuntime();
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({ username: "u", password: "p", maxSize: 1 });
    const scope = new RequestScope({ pool });

    const session = await scope.session();
    assert.equal(scope.activeSession, session);
    assert.equal(pool.stats().inUse, 1);

    assert.deepEqual(await scope.finalize(undefined, { responseStatus: 204 }), {
      action: "commit",
      clean: true,
      discard: false,
    });
    assert.equal(pool.stats().idle, 1);
    assert(runtime.calls.some((call) => call.method === "commit"));
    assert.deepEqual(await scope.finalize(), {
      action: "already_finalized",
      clean: true,
      discard: false,
    });

    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("RequestScope aborts failed outcomes before returning pooled sessions", async () => {
  const runtime = new MockGciRuntime();
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({ username: "u", password: "p", maxSize: 1 });
    const scope = new RequestScope({ pool });
    await scope.session();

    assert.deepEqual(await scope.finalize(undefined, { responseStatus: 500 }), {
      action: "abort",
      clean: true,
      discard: false,
    });
    assert.equal(pool.stats().idle, 1);
    assert(runtime.calls.some((call) => call.method === "abort"));

    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

test("RequestScope owns and logs out sessions created from sessionConfig", async () => {
  const runtime = new MockGciRuntime();
  const scope = new RequestScope({
    sessionConfig: { username: "u", password: "p", runtime },
  });

  const session = await scope.session();
  assert(session instanceof Session);
  await scope.finalize();

  assert(runtime.calls.some((call) => call.method === "commit"));
  assert(runtime.calls.some((call) => call.method === "logout"));
});

test("withSessionScope preserves application errors after aborting", async () => {
  const runtime = new MockGciRuntime();
  setGciRuntimeForTesting(runtime);
  try {
    const pool = new SessionPool({ username: "u", password: "p", maxSize: 1 });

    await assert.rejects(
      () => withSessionScope({ pool }, async () => {
        throw new Error("handler failed");
      }),
      /handler failed/,
    );

    assert.equal(pool.stats().idle, 1);
    assert(runtime.calls.some((call) => call.method === "abort"));

    await pool.close();
  } finally {
    setGciRuntimeForTesting(undefined);
  }
});

class FakeTransactionSession implements TransactionSession {
  readonly calls: string[] = [];
  readonly #commitError?: Error;
  readonly #abortError?: Error;

  constructor(options: { commitError?: Error; abortError?: Error } = {}) {
    this.#commitError = options.commitError;
    this.#abortError = options.abortError;
  }

  async commit(): Promise<void> {
    this.calls.push("commit");
    if (this.#commitError) throw this.#commitError;
  }

  async abort(): Promise<void> {
    this.calls.push("abort");
    if (this.#abortError) throw this.#abortError;
  }
}
