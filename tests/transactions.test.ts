import assert from "node:assert/strict";
import test from "node:test";
import {
  CommitConflictError,
  Session,
  TransactionRetry,
  commitWithConflictDetails,
  formatCommitConflict,
  formatConflictDiagnostics,
  retryingTransaction,
  runTransactionWithRetry,
  smallintToOop,
  type Oop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

test("runTransactionWithRetry replays work after commit conflicts on an existing session", async () => {
  const session = fakeSession();
  const conflict = new CommitConflictError("conflict", [101n as Oop]);
  const attempts: number[] = [];
  const retries: TransactionRetry[] = [];
  let commitCount = 0;

  const result = await runTransactionWithRetry(
    async (currentSession) => {
      assert.equal(currentSession, session);
      attempts.push(attempts.length + 1);
      return "done";
    },
    {
      session,
      attempts: 2,
      onConflict: (retry) => {
        retries.push(retry);
      },
      commit: async () => {
        commitCount += 1;
        if (commitCount === 1) throw conflict;
      },
    },
  );

  assert.equal(result, "done");
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(session.aborts, 1);
  assert.equal(retries[0].attempt, 1);
  assert.equal(retries[0].remaining, 1);
  assert.equal(retries[0].willRetry, true);
  assert.equal(retries[0].exhausted, false);
  assert.equal(retries[0].conflict, conflict);
});

test("runTransactionWithRetry raises the last conflict after attempts are exhausted", async () => {
  const session = fakeSession();
  const conflict = new CommitConflictError("conflict");

  await assert.rejects(
    () => runTransactionWithRetry(
      async () => "ignored",
      {
        session,
        attempts: 2,
        commit: async () => {
          throw conflict;
        },
      },
    ),
    CommitConflictError,
  );

  assert.equal(session.aborts, 2);
});

test("retryingTransaction opens and closes owned sessions per attempt", async () => {
  const created: FakeSession[] = [];
  const conflict = new CommitConflictError("conflict");

  const result = await retryingTransaction(
    async (session) => {
      const fake = session as unknown as FakeSession;
      return fake.label;
    },
    {
      attempts: 2,
      sessionFactory: async () => {
        const session = fakeSession(`session-${created.length + 1}`);
        created.push(session);
        return session;
      },
      commit: async (session) => {
        if ((session as unknown as FakeSession).label === "session-1") throw conflict;
      },
    },
  );

  assert.equal(result, "session-2");
  assert.equal(created.length, 2);
  assert.equal(created[0].aborts, 1);
  assert.equal(created[0].logouts, 1);
  assert.equal(created[1].logouts, 1);
});

test("transaction retry validates options and aborts user errors", async () => {
  await assert.rejects(() => runTransactionWithRetry(async () => undefined, { attempts: 0 }), RangeError);
  await assert.rejects(
    () => runTransactionWithRetry(async () => undefined, { session: fakeSession(), config: { username: "u", password: "p" } }),
    TypeError,
  );

  const session = fakeSession();
  await assert.rejects(
    () => runTransactionWithRetry(async () => {
      throw new Error("boom");
    }, { session }),
    /boom/,
  );
  assert.equal(session.aborts, 1);
});

test("commitWithConflictDetails converts generic commit failures to structured conflicts", async () => {
  const conflictCollection = 0x9100n as Oop;
  const conflictObject = 0x9200n as Oop;
  const arrays = new Map<Oop, Oop[]>([[conflictCollection, [conflictObject]]]);
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    commitResult: false,
    error: null,
    async execute(source): Promise<Oop> {
      if (source === "System conflictReportString") return runtime.newString("raw conflict report");
      if (source === "System currentTransactionWWConflicts") return conflictCollection;
      if (source === "System currentTransactionWDConflicts") return 0x9300n as Oop;
      return 0x9400n as Oop;
    },
    perform(receiver, selector, args) {
      const values = arrays.get(receiver) ?? [];
      if (selector === "size") return smallintToOop(values.length);
      if (selector === "at:") return values[Number(args[0] >> 3n) - 1] ?? 0x14n as Oop;
      return 0x14n as Oop;
    },
  });
  arrays.set(0x9300n as Oop, []);
  const session = await Session.connect({ username: "u", password: "p", runtime });

  await assert.rejects(
    async () => commitWithConflictDetails(session),
    (error) => {
      assert(error instanceof CommitConflictError);
      assert.equal(error.report, "raw conflict report");
      assert.deepEqual(error.writeWriteConflicts, [conflictObject]);
      return true;
    },
  );

  await session.logout();
});

test("commit conflict diagnostics format and serialize conflicts", async () => {
  const conflict = new CommitConflictError("line one\nline two", [101n as Oop], [202n as Oop]);
  const retry = new TransactionRetry({ attempt: 2, attempts: 2, conflict });

  const diagnostics = await conflict.diagnostics();
  const text = await formatCommitConflict(conflict);
  const retryText = await retry.format();
  const payload = await retry.toObject();

  assert.equal(diagnostics.writeWrite[0].oop, 101n);
  assert.match(text, /Write\/write conflicts:/);
  assert.match(text, /0x0000000000000065 \(101\)/);
  assert.match(text, /GemStone report:/);
  assert.match(retryText, /attempt 2\/2/);
  assert.equal(payload.remaining, 0);
  assert.equal(payload.exhausted, true);
  assert.deepEqual(formatConflictDiagnostics({ report: "", writeWrite: [], writeDependency: [] }), "Commit conflict");
});

interface FakeSession extends Session {
  label: string;
  aborts: number;
  logouts: number;
}

function fakeSession(label = "session"): FakeSession {
  const session = {
    label,
    aborts: 0,
    logouts: 0,
    async commit() {},
    async abort() {
      session.aborts += 1;
    },
    async logout() {
      session.logouts += 1;
    },
  };
  return session as unknown as FakeSession;
}
