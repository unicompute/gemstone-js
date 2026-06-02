import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  BENCHMARK_REPORT_SCHEMA_PATH,
  BENCHMARK_REPORT_SCHEMA_VERSION,
  DEFAULT_BENCHMARK_ENTRIES,
  DEFAULT_BENCHMARK_SEARCH_RUNS,
  DEFAULT_BENCHMARK_SUITES,
  buildBenchmarkReport,
  formatBenchmarkResults,
  runBenchmarkSuite,
  runBenchmarksCli,
  selectedBenchmarkSuitesRequireLive,
  type BenchmarkResultRow,
  type BenchmarksCliIo,
} from "../src/index.ts";

const benchmarksScript = fileURLToPath(new URL("../scripts/benchmarks.mjs", import.meta.url));

test("offline benchmark suite produces gci report rows", async () => {
  const results = await runBenchmarkSuite({ suites: ["gci"], entries: 100 });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.suite, "gci");
  assert.equal(results[0]?.operation, "smallint_roundtrip");
  assert.equal(results[0]?.count, 100);
  assert.ok((results[0]?.elapsed_seconds ?? 0) > 0);
  assert.ok((results[0]?.ops_per_second ?? 0) > 0);
  assert.match(results[0]?.note ?? "", /^checksum=/);
  assert.equal(selectedBenchmarkSuitesRequireLive(["gci"]), false);
  assert.equal(selectedBenchmarkSuitesRequireLive(["gci", "gstore"]), true);
});

test("benchmark report builder records runtime metadata", () => {
  const results: BenchmarkResultRow[] = [
    { suite: "gci", operation: "smallint_roundtrip", count: 10, elapsed_seconds: 0.001, ops_per_second: 10_000 },
  ];
  const report = buildBenchmarkReport({
    suites: ["gci"],
    entries: 10,
    searchRuns: 1,
    results,
    stone: "benchstone",
    host: "benchhost",
    gciBackend: "mock",
  });

  assert.equal(report.schema_version, BENCHMARK_REPORT_SCHEMA_VERSION);
  assert.equal(report.$schema, BENCHMARK_REPORT_SCHEMA_PATH);
  assert.equal(report.runtime, "node");
  assert.equal(report.stone, "benchstone");
  assert.equal(report.host, "benchhost");
  assert.equal(report.gci_backend, "mock");
  assert.equal(report.entries, 10);
  assert.equal(report.search_runs, 1);
  assert.deepEqual(report.suites, ["gci"]);
  assert.deepEqual(report.results, results);
  assert.match(formatBenchmarkResults(results), /smallint_roundtrip/);
});

test("benchmarks CLI runs offline gci without opening a session", async () => {
  let connectCalls = 0;
  const io = fakeIo(async () => {
    connectCalls += 1;
    throw new Error("live connect should not be used");
  });

  assert.equal(await runBenchmarksCli(["--suite", "gci", "--entries", "25", "--json"], io), 0);
  assert.equal(connectCalls, 0);

  const report = JSON.parse(io.stdoutText());
  assert.equal(report.schema_version, BENCHMARK_REPORT_SCHEMA_VERSION);
  assert.equal(report.$schema, BENCHMARK_REPORT_SCHEMA_PATH);
  assert.equal(report.entries, 25);
  assert.deepEqual(report.suites, ["gci"]);
  assert.equal(report.results[0].suite, "gci");
  assert.equal(io.stderrText(), "");
});

test("benchmarks CLI writes output files and reports usage errors", async () => {
  await withTempFixture(async (fixture) => {
    const output = join(fixture.path, "report.json");
    const io = fakeIo();

    assert.equal(await runBenchmarksCli(["--suite", "gci", "--entries", "5", "--json", "--output", output], io), 0);
    assert.equal(io.stdoutText(), "");
    assert.equal(JSON.parse(await readFile(output, "utf8")).entries, 5);

    const usageIo = fakeIo();
    assert.equal(await runBenchmarksCli(["--entries", "0"], usageIo), 2);
    assert.match(usageIo.stderrText(), /entries must be a positive integer/);
  });
});

test("benchmarks CLI opens a live session only for live suites", async () => {
  let connectCalls = 0;
  const io = fakeIo(async () => {
    connectCalls += 1;
    throw new Error("live disabled");
  });

  assert.equal(await runBenchmarksCli(["--suite", "gstore", "--entries", "1"], io), 1);
  assert.equal(connectCalls, 1);
  assert.match(io.stderrText(), /live disabled/);
});

test("benchmark CLI script prints help without connecting", async () => {
  const { stdout } = await execNode([benchmarksScript, "--help"]);

  assert.match(stdout, /gemstone-js-benchmarks/);
  assert.match(stdout, new RegExp(DEFAULT_BENCHMARK_SUITES.join(", ")));
  assert.equal(DEFAULT_BENCHMARK_ENTRIES, 200);
  assert.equal(DEFAULT_BENCHMARK_SEARCH_RUNS, 10);
});

async function tempFixture(): Promise<AsyncDisposable & { path: string }> {
  const path = await mkdtemp(join(tmpdir(), "gemstone-js-bench-run-"));
  return {
    path,
    async [Symbol.asyncDispose]() {
      await rm(path, { recursive: true, force: true });
    },
  };
}

async function withTempFixture<T>(work: (fixture: AsyncDisposable & { path: string }) => Promise<T>): Promise<T> {
  const fixture = await tempFixture();
  try {
    return await work(fixture);
  } finally {
    await fixture[Symbol.asyncDispose]();
  }
}

function fakeIo(connect?: BenchmarksCliIo["connect"]): BenchmarksCliIo & {
  stdoutText(): string;
  stderrText(): string;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    connect: connect ?? (async () => {
      throw new Error("live connect unavailable");
    }),
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
