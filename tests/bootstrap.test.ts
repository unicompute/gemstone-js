import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOTSTRAP_MARKER_KEY,
  BOOTSTRAP_VERSION,
  auditBootstrap,
  bootstrapGemStone,
  bootstrapSource,
  formatBootstrapPlan,
  formatBootstrapResult,
  formatBootstrapStatuses,
  runBootstrapCli,
  type BootstrapCliSession,
} from "../src/index.ts";

const bootstrapScript = fileURLToPath(new URL("../scripts/bootstrap.mjs", import.meta.url));

test("bootstrapSource renders idempotent GemStone-side root creation", () => {
  const source = bootstrapSource();

  assert.match(source, /UserGlobals at: #GStoreRoot put: StringKeyValueDictionary new/);
  assert.match(source, /UserGlobals at: #GSQueryRoot put: Dictionary new/);
  assert.match(source, new RegExp(`UserGlobals at: #${BOOTSTRAP_MARKER_KEY} put: version`));
  assert.match(source, /gemstone-js bootstrap/);
});

test("auditBootstrap reports root and builtin artifact status", async () => {
  const session = new FakeBootstrapSession(["GStoreRoot"]);

  const statuses = await auditBootstrap(session);
  const byName = new Map(statuses.map((status) => [status.artifact.name, status.present]));

  assert.equal(byName.get(BOOTSTRAP_MARKER_KEY), false);
  assert.equal(byName.get("GStoreRoot"), true);
  assert.equal(byName.get("GSQueryRoot"), false);
  assert.equal(byName.get("ObjectLogEntry objectLog"), true);
});

test("bootstrapGemStone applies source, reports created keys, and can commit", async () => {
  const session = new FakeBootstrapSession(["GStoreRoot"]);

  const result = await bootstrapGemStone(session, { commit: true });

  assert.equal(result.version, BOOTSTRAP_VERSION);
  assert.equal(result.applied, true);
  assert.deepEqual(result.createdKeys, ["GemstoneJsBootstrapVersion", "GSQueryRoot"]);
  assert.equal(session.evals.includes(bootstrapSource()), true);
  assert.equal(session.commits, 1);
  assert.equal(result.after.every((status) => status.present), true);
  assert.match(formatBootstrapResult(result), /Created UserGlobals keys: GemstoneJsBootstrapVersion, GSQueryRoot/);
});

test("bootstrapGemStone dry run audits without evaluating source", async () => {
  const session = new FakeBootstrapSession(["GStoreRoot"]);

  const result = await bootstrapGemStone(session, { dryRun: true });

  assert.equal(result.applied, false);
  assert.deepEqual(result.createdKeys, []);
  assert.equal(session.evals.includes(bootstrapSource()), false);
  assert.equal(result.before, result.after);
});

test("bootstrap format helpers render plans and statuses", async () => {
  const session = new FakeBootstrapSession(["GStoreRoot"]);
  const statuses = await auditBootstrap(session);

  assert.match(formatBootstrapPlan(), /UserGlobals at: #GStoreRoot/);
  assert.match(formatBootstrapPlan(), /ObjectLogEntry objectLog/);
  assert.match(formatBootstrapStatuses(statuses), /missing: UserGlobals at: #GSQueryRoot/);
  assert.match(formatBootstrapStatuses(statuses), /present: ObjectLogEntry objectLog/);
});

test("bootstrap CLI supports local-only dry-run and source output", async () => {
  let connectCount = 0;
  const io = fakeIo(() => {
    connectCount += 1;
    throw new Error("should not connect");
  });

  assert.equal(await runBootstrapCli(["--print-source"], io), 0);
  assert.match(io.stdoutText(), /GStoreRoot/);
  assert.equal(connectCount, 0);

  const dryRunIo = fakeIo(() => {
    connectCount += 1;
    throw new Error("should not connect");
  });
  assert.equal(await runBootstrapCli(["--dry-run"], dryRunIo), 0);
  assert.match(dryRunIo.stdoutText(), /bootstrap dry run/);
  assert.equal(connectCount, 0);
});

test("bootstrap CLI audits status, applies bootstrap, and rejects conflicting actions", async () => {
  const statusSession = new FakeBootstrapSession(["GStoreRoot"]);
  const statusIo = fakeIo(async () => statusSession);

  assert.equal(await runBootstrapCli(["--status"], statusIo), 0);
  assert.match(statusIo.stdoutText(), /missing: UserGlobals at: #GSQueryRoot/);
  assert.equal(statusSession.aborts, 1);
  assert.equal(statusSession.logouts, 1);

  const bootstrapSession = new FakeBootstrapSession([]);
  const bootstrapIo = fakeIo(async () => bootstrapSession);
  assert.equal(await runBootstrapCli([], bootstrapIo), 0);
  assert.match(bootstrapIo.stdoutText(), /Created UserGlobals keys/);
  assert.equal(bootstrapSession.commits, 1);
  assert.equal(bootstrapSession.logouts, 1);

  const badIo = fakeIo(async () => new FakeBootstrapSession());
  assert.equal(await runBootstrapCli(["--status", "--dry-run"], badIo), 2);
  assert.match(badIo.stderrText(), /Pass only one action/);
});

test("bootstrap CLI script prints help without connecting", async () => {
  const { stdout } = await execNode([bootstrapScript, "--help"]);
  assert.match(stdout, /Usage: gemstone-js-bootstrap/);
  assert.match(stdout, /--status/);
});

class FakeBootstrapSession implements BootstrapCliSession {
  readonly presentKeys = new Set<string>();
  readonly evals: string[] = [];
  commits = 0;
  aborts = 0;
  logouts = 0;

  constructor(keys: readonly string[] = []) {
    for (const key of keys) this.presentKeys.add(key);
  }

  async eval(source: string): Promise<boolean | string> {
    this.evals.push(source);
    if (source.startsWith("UserGlobals includesKey: #")) {
      const key = source.slice("UserGlobals includesKey: #".length);
      return this.presentKeys.has(key);
    }
    if (source === "ObjectLogEntry objectLog notNil") return true;
    if (source === bootstrapSource()) {
      const created: string[] = [];
      for (const key of ["GStoreRoot", "GSQueryRoot", BOOTSTRAP_MARKER_KEY]) {
        if (!this.presentKeys.has(key)) created.push(key);
        this.presentKeys.add(key);
      }
      return `gemstone-js bootstrap ${BOOTSTRAP_VERSION} created: #(${created.map((key) => `'${key}'`).join(" ")})`;
    }
    throw new Error(`Unexpected eval source: ${source}`);
  }

  async commit(): Promise<void> {
    this.commits += 1;
  }

  async abort(): Promise<void> {
    this.aborts += 1;
  }

  async logout(): Promise<void> {
    this.logouts += 1;
  }
}

function fakeIo(connect: () => Promise<BootstrapCliSession> | BootstrapCliSession): {
  stdoutText(): string;
  stderrText(): string;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  connect(): Promise<BootstrapCliSession>;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    connect: async () => connect(),
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
