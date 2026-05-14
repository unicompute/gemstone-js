import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_MANIFEST_SCHEMA_VERSION,
  BENCHMARK_COMPARISON_SCHEMA_VERSION,
  BENCHMARK_REPORT_SCHEMA_VERSION,
  compareBenchmarkReports,
  formatBenchmarkComparison,
  pruneBenchmarkBaselineManifest,
  registerBenchmarkBaseline,
  runBenchmarkBaselinesCli,
  runBenchmarkCompareCli,
  runBenchmarkRegisterCli,
  selectBenchmarkBaseline,
  type BenchmarkReport,
} from "../src/index.ts";

const compareScript = fileURLToPath(new URL("../scripts/benchmark-compare.mjs", import.meta.url));
const baselinesScript = fileURLToPath(new URL("../scripts/benchmark-baselines.mjs", import.meta.url));
const registerScript = fileURLToPath(new URL("../scripts/benchmark-register.mjs", import.meta.url));

test("benchmark comparison reports regressions and threshold precedence", async () => {
  await using fixture = await tempFixture();
  const baseline = join(fixture.path, "baseline.json");
  const candidate = join(fixture.path, "candidate.json");
  await writeReport(baseline, report({
    results: [
      result("gci", "execute", 100, 10),
      result("gstore", "snapshot", 200, 5),
    ],
  }));
  await writeReport(candidate, report({
    results: [
      result("gci", "execute", 94, 10),
      result("gstore", "snapshot", 170, 5),
      result("new", "extra", 1, 1),
    ],
  }));

  const comparison = compareBenchmarkReports({
    baselinePath: baseline,
    candidatePath: candidate,
    maxRegressionPct: 10,
    suiteRegressionPcts: { gci: 5 },
    operationRegressionPcts: { "gstore/snapshot": 20 },
  });

  assert.equal(comparison.schemaVersion, BENCHMARK_COMPARISON_SCHEMA_VERSION);
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.thresholdExceeded, true);
  assert.deepEqual(comparison.thresholdExceededOperations, ["gci/execute"]);
  assert.equal(comparison.rows.find((row) => row.suite === "gci")?.thresholdScope, "suite");
  assert.equal(comparison.rows.find((row) => row.suite === "gstore")?.thresholdScope, "operation");
  assert.equal(comparison.rows.find((row) => row.suite === "new")?.status, "missing_in_baseline");
  assert.match(formatBenchmarkComparison(comparison), /Regression Threshold: 10.0% \(exceeded\)/);
});

test("benchmark comparison skips threshold enforcement when metadata differs", async () => {
  await using fixture = await tempFixture();
  const baseline = join(fixture.path, "baseline.json");
  const candidate = join(fixture.path, "candidate.json");
  await writeReport(baseline, report({ stone: "stone-a", results: [result("gci", "execute", 100, 1)] }));
  await writeReport(candidate, report({ stone: "stone-b", results: [result("gci", "execute", 1, 1)] }));

  const comparison = compareBenchmarkReports({ baselinePath: baseline, candidatePath: candidate, maxRegressionPct: 1 });

  assert.equal(comparison.comparable, false);
  assert.equal(comparison.thresholdExceeded, false);
  assert.match(comparison.compatibilityIssues[0], /stone differs/);
});

test("baseline selection matches normalized metadata and rejects duplicates", async () => {
  await using fixture = await tempFixture();
  const manifest = join(fixture.path, "index.json");
  const first = join(fixture.path, "first.json");
  const second = join(fixture.path, "second.json");
  const candidate = join(fixture.path, "candidate.json");
  await writeReport(first, report({ suites: ["gstore", "gci"], results: [result("gci", "execute", 100, 1)] }));
  await writeReport(second, report({ stone: "other", results: [result("gci", "execute", 100, 1)] }));
  await writeReport(candidate, report({ suites: ["gci", "gstore"], results: [result("gci", "execute", 90, 1)] }));
  await writeJson(manifest, { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: ["first.json", { path: "second.json" }] });

  const selection = selectBenchmarkBaseline({ candidateReportPath: candidate, manifestPath: manifest });

  assert.equal(selection.comparable, true);
  assert.equal(selection.selectedPath, first);

  await writeJson(manifest, { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: ["first.json", "candidate.json"] });
  assert.throws(() => selectBenchmarkBaseline({ candidateReportPath: candidate, manifestPath: manifest }), /Multiple benchmark baselines/);
});

test("baseline registration copies external reports and prunes manifests", async () => {
  await using fixture = await tempFixture();
  const external = join(fixture.path, "external", "report.json");
  const manifest = join(fixture.path, "benchmarks", "index.json");
  await writeReport(external, report({ results: [result("gci", "execute", 100, 1)] }));

  const registered = registerBenchmarkBaseline({
    reportPath: external,
    manifestPath: manifest,
    copyTo: "baseline-macos-arm64.json",
  });

  assert.equal(registered.copied, true);
  assert.equal(registered.addedToManifest, true);
  assert.equal(registered.registeredPath, "baseline-macos-arm64.json");
  assert.deepEqual(JSON.parse(await readFile(manifest, "utf8")).baselines, ["baseline-macos-arm64.json"]);

  const duplicate = registerBenchmarkBaseline({
    reportPath: external,
    manifestPath: manifest,
    copyTo: "baseline-macos-arm64.json",
  });
  assert.equal(duplicate.addedToManifest, false);

  await writeJson(manifest, {
    schema_version: BASELINE_MANIFEST_SCHEMA_VERSION,
    baselines: ["baseline-macos-arm64.json", "missing.json", "baseline-macos-arm64.json"],
  });
  const pruned = pruneBenchmarkBaselineManifest({ manifestPath: manifest, removeMissing: true });
  assert.deepEqual(pruned.removedPaths, ["missing.json", "baseline-macos-arm64.json"]);
  assert.deepEqual(JSON.parse(await readFile(manifest, "utf8")).baselines, ["baseline-macos-arm64.json"]);
});

test("benchmark CLIs render JSON and threshold exit codes", async () => {
  await using fixture = await tempFixture();
  const baseline = join(fixture.path, "baseline.json");
  const candidate = join(fixture.path, "candidate.json");
  const manifest = join(fixture.path, "index.json");
  await writeReport(baseline, report({ results: [result("gci", "execute", 100, 1)] }));
  await writeReport(candidate, report({ results: [result("gci", "execute", 80, 1)] }));
  await writeJson(manifest, { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: ["baseline.json"] });

  const compareIo = fakeIo();
  assert.equal(await runBenchmarkCompareCli([baseline, candidate, "--json", "--max-regression-pct", "10"], compareIo), 2);
  assert.equal(JSON.parse(compareIo.stdoutText()).thresholdExceeded, true);

  const baselinesIo = fakeIo();
  assert.equal(await runBenchmarkBaselinesCli([candidate, "--manifest", manifest, "--json"], baselinesIo), 0);
  assert.equal(JSON.parse(baselinesIo.stdoutText()).selectedPath, baseline);

  const registerIo = fakeIo();
  const registeredManifest = join(fixture.path, "registered", "index.json");
  assert.equal(await runBenchmarkRegisterCli([candidate, "--manifest", registeredManifest, "--json"], registerIo), 0);
  assert.equal(JSON.parse(registerIo.stdoutText()).addedToManifest, true);
});

test("benchmark CLI scripts print help without file IO", async () => {
  assert.match((await execNode([compareScript, "--help"])).stdout, /gemstone-js-benchmark-compare/);
  assert.match((await execNode([baselinesScript, "--help"])).stdout, /gemstone-js-benchmark-baselines/);
  assert.match((await execNode([registerScript, "--help"])).stdout, /gemstone-js-benchmark-register/);
});

function report(overrides: Partial<BenchmarkReport> = {}): BenchmarkReport {
  return {
    schema_version: BENCHMARK_REPORT_SCHEMA_VERSION,
    generated_at: "2026-05-14T00:00:00.000Z",
    stone: "gs64stone",
    platform: "darwin-arm64",
    runtime: "node",
    node_version: "24.0.0",
    gci_backend: "native",
    entries: 500,
    search_runs: 20,
    suites: ["gci"],
    results: [],
    ...overrides,
  };
}

function result(suite: string, operation: string, opsPerSecond: number, count: number): BenchmarkReport["results"][number] {
  return { suite, operation, ops_per_second: opsPerSecond, count };
}

async function writeReport(path: string, value: BenchmarkReport): Promise<void> {
  await writeJson(path, value);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function tempFixture(): Promise<AsyncDisposable & { path: string }> {
  const path = await mkdtemp(join(tmpdir(), "gemstone-js-bench-"));
  return {
    path,
    async [Symbol.asyncDispose]() {
      await rm(path, { recursive: true, force: true });
    },
  };
}

function fakeIo(): {
  stdoutText(): string;
  stderrText(): string;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
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
