import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MIGRATION_LOCK,
  DEFAULT_MIGRATION_ROOT,
  MigrationError,
  RecordingMigrationSession,
  acquireMigrationLock,
  currentVersion,
  downgrade,
  formatMigrationResult,
  formatMigrationStatus,
  migrationStatus,
  migrationStepsFromManifest,
  planDowngrade,
  planUpgrade,
  releaseMigrationLock,
  runMigrationsCli,
  Session,
  upgrade,
  validateMigrationState,
  type MigrationStep,
  type Oop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

const migrationsScript = fileURLToPath(new URL("../scripts/migrations.mjs", import.meta.url));

test("migration planning orders dependencies and skips applied steps", () => {
  const calls: string[] = [];
  const first: MigrationStep = { id: "001_initial", upgrade: () => { calls.push("first"); } };
  const second: MigrationStep = {
    id: "002_total",
    dependencies: ["001_initial"],
    upgrade: () => { calls.push("second"); },
  };

  assert.deepEqual(planUpgrade([second, first], { "001_initial": {} }).map((step) => step.id), ["002_total"]);
  assert.deepEqual(planDowngrade(
    [first, { ...second, downgrade: () => undefined }],
    { "001_initial": {}, "002_total": {} },
    { target: "001_initial" },
  ).map((step) => step.id), ["002_total"]);

  assert.throws(() => planUpgrade([{ ...first, id: "001_initial" }, first], {}), /duplicate/);
  assert.throws(() => planUpgrade([{ ...second, dependencies: ["missing"] }], {}), /depends on unknown/);
});

test("migration state validation rejects unknown applied ids and checksum drift", () => {
  const step: MigrationStep = { id: "001_initial", checksum: "local", upgrade: () => undefined };

  assert.throws(
    () => validateMigrationState([step], { "999_missing": {} }),
    /not present in the local manifest/,
  );
  assert.throws(
    () => validateMigrationState([step], { "001_initial": { checksum: "stored" } }),
    /checksum mismatch/,
  );
});

test("recording migration session captures common session calls", async () => {
  const recorder = new RecordingMigrationSession();

  await recorder.eval("1 + 2");
  await recorder.globalSet("MigrationFlag", "ready");
  await recorder.performValueWith(123n as Oop, "touch:", 4);
  await recorder.commit();

  assert.deepEqual(recorder.operations, [
    'session.eval("1 + 2")',
    'session.globalSet("MigrationFlag", "ready")',
    'session.performValueWith(123, "touch:", 4)',
    "session.commit()",
  ]);
});

test("upgrade records versions, commits each step, and releases migration locks", async () => {
  const { session, runtime } = await newSession();
  const calls: string[] = [];
  const first: MigrationStep = {
    id: "001_initial",
    description: "Create flag.",
    checksum: "abc",
    upgrade: async (current) => {
      calls.push("up1");
      await current.globalSet("MigrationProbe", "ready");
    },
    downgrade: async (current) => {
      calls.push("down1");
      await current.globalRemove("MigrationProbe");
    },
  };
  const second: MigrationStep = {
    id: "002_total",
    dependencies: ["001_initial"],
    upgrade: () => { calls.push("up2"); },
    downgrade: () => { calls.push("down2"); },
  };

  const result = await upgrade(session, [second, first], { lockOwner: "test-owner" });

  assert.deepEqual(result.steps, ["001_initial", "002_total"]);
  assert.deepEqual(calls, ["up1", "up2"]);
  assert.equal(await currentVersion(session), "002_total");
  assert.equal(await session.globalGetValue("MigrationProbe"), "ready");
  assert.equal(await session.globalHas(DEFAULT_MIGRATION_LOCK), false);
  assert.equal(runtime.calls.filter((call) => call.method === "commit").length, 4);

  const status = await migrationStatus(session, [first, second]);
  assert.deepEqual(status, { current: "002_total", applied: ["001_initial", "002_total"], pending: [] });
  assert.match(formatMigrationStatus(status), /current: 002_total/);
  assert.match(formatMigrationResult(result), /upgrade: 2 step\(s\)/);

  await session.logout();
});

test("upgrade dry-run can record operations without mutating migration state", async () => {
  const { session, runtime } = await newSession();
  const step: MigrationStep = {
    id: "001_initial",
    upgrade: async (current) => {
      await current.globalSet("MigrationProbe", "ready");
      await current.commit();
    },
  };

  const result = await upgrade(session, [step], { dryRun: true, recordDryRun: true });

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.steps, ["001_initial"]);
  assert.deepEqual(result.operations, [
    "# upgrade 001_initial",
    'session.globalSet("MigrationProbe", "ready")',
    "session.commit()",
  ]);
  assert.equal(await currentVersion(session), null);
  assert.equal(await session.globalHas("MigrationProbe"), false);
  assert.equal(runtime.calls.filter((call) => call.method === "commit").length, 0);

  await session.logout();
});

test("downgrade removes applied records and requires rollback callbacks", async () => {
  const { session } = await newSession();
  const calls: string[] = [];
  const first: MigrationStep = {
    id: "001_initial",
    upgrade: async (current) => { await current.globalSet("MigrationProbe", "ready"); },
    downgrade: async (current) => {
      calls.push("down1");
      await current.globalRemove("MigrationProbe");
    },
  };
  const second: MigrationStep = {
    id: "002_total",
    dependencies: ["001_initial"],
    upgrade: () => undefined,
    downgrade: () => { calls.push("down2"); },
  };
  await upgrade(session, [first, second], { useLock: false });

  const result = await downgrade(session, [first, second], { target: "001_initial", useLock: false });

  assert.deepEqual(result.steps, ["002_total"]);
  assert.deepEqual(calls, ["down2"]);
  assert.equal(await currentVersion(session), "001_initial");
  await assert.rejects(
    downgrade(session, [{ id: "001_initial", upgrade: () => undefined }], { target: "base", dryRun: true }),
    /do not support downgrade/,
  );

  const base = await downgrade(session, [first, second], { target: "base", useLock: false });
  assert.deepEqual(base.steps, ["001_initial"]);
  assert.deepEqual(calls, ["down2", "down1"]);
  assert.equal(await currentVersion(session), null);
  assert.equal(await session.globalHas(DEFAULT_MIGRATION_ROOT), false);

  await session.logout();
});

test("migration locks reject active owners and replace stale owners", async () => {
  const { session } = await newSession();
  const active = await acquireMigrationLock(session, { owner: "active", staleAfterSeconds: null });
  await assert.rejects(
    acquireMigrationLock(session, { owner: "blocked", staleAfterSeconds: null }),
    /migration lock/,
  );
  await releaseMigrationLock(session, active);

  await session.globalSet(DEFAULT_MIGRATION_LOCK, JSON.stringify({
    key: DEFAULT_MIGRATION_LOCK,
    owner: "old",
    acquiredAt: "2000-01-01T00:00:00.000Z",
    rootKey: DEFAULT_MIGRATION_ROOT,
  }));
  const stale = await acquireMigrationLock(session, { owner: "new", staleAfterSeconds: 1 });
  assert.equal(stale.owner, "new");
  await releaseMigrationLock(session, stale);
  assert.equal(await session.globalHas(DEFAULT_MIGRATION_LOCK), false);

  await session.logout();
});

test("migration manifest coercion and CLI actions are injectable", async () => {
  const step: MigrationStep = {
    id: "001_initial",
    description: "Create flag.",
    upgrade: async (session) => { await session.globalSet("MigrationProbe", "ready"); },
  };
  assert.deepEqual(migrationStepsFromManifest({ migrations: [step] }).map((item) => item.id), ["001_initial"]);
  assert.deepEqual(migrationStepsFromManifest({ default: { MIGRATIONS: [step] } }).map((item) => item.id), ["001_initial"]);

  const statusFixture = await newSession();
  const statusIo = fakeIo(statusFixture.session, [step]);
  assert.equal(await runMigrationsCli(["status", "--manifest", "app.migrations"], statusIo), 0);
  assert.match(statusIo.stdoutText(), /pending: 1/);
  assert.equal(statusIo.logoutCount(), 1);

  const planFixture = await newSession();
  const planIo = fakeIo(planFixture.session, [step]);
  assert.equal(await runMigrationsCli(["plan", "--manifest", "app.migrations"], planIo), 0);
  assert.match(planIo.stdoutText(), /001_initial - Create flag/);

  const dryRunFixture = await newSession();
  const dryRunIo = fakeIo(dryRunFixture.session, [step]);
  assert.equal(await runMigrationsCli(["upgrade", "--manifest", "app.migrations", "--dry-run", "--record"], dryRunIo), 0);
  assert.match(dryRunIo.stdoutText(), /recorded operations:/);
  assert.match(dryRunIo.stdoutText(), /globalSet/);

  const badFixture = await newSession();
  const badIo = fakeIo(badFixture.session, [step]);
  assert.equal(await runMigrationsCli(["upgrade"], badIo), 2);
  assert.match(badIo.stderrText(), /requires --manifest/);
  await badFixture.session.logout();
});

test("migrations CLI script prints help without connecting", async () => {
  const { stdout } = await execNode([migrationsScript, "--help"]);
  assert.match(stdout, /Usage: gemstone-js-migrations/);
  assert.match(stdout, /upgrade --manifest/);
});

async function newSession(): Promise<{ session: Session; runtime: MockGciRuntime }> {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  return { session, runtime };
}

function fakeIo(session: Session, steps: readonly MigrationStep[]): {
  stdoutText(): string;
  stderrText(): string;
  logoutCount(): number;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  connect(): Promise<Session>;
  loadManifest(specifier: string): Promise<readonly MigrationStep[]>;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let logouts = 0;
  const originalLogout = session.logout.bind(session);
  return {
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
    logoutCount: () => logouts,
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    connect: async () => {
      session.logout = async () => {
        logouts += 1;
        await originalLogout();
      };
      return session;
    },
    loadManifest: async (specifier) => {
      assert.equal(specifier, "app.migrations");
      return steps;
    },
  };
}

function execNode(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}
