import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  BASELINE_MANIFEST_SCHEMA_PATH,
  BASELINE_MANIFEST_SCHEMA_VERSION,
  BENCHMARK_COMPARISON_SCHEMA_VERSION,
  BENCHMARK_REPORT_SCHEMA_PATH,
  BENCHMARK_REPORT_SCHEMA_VERSION,
  BENCHMARK_VALIDATION_SCHEMA_VERSION,
  compareBenchmarkCandidateWithManifest,
  compareBenchmarkReports,
  formatBenchmarkComparison,
  loadBenchmarkReport,
  pruneBenchmarkBaselineManifest,
  registerBenchmarkBaseline,
  runBenchmarkBaselinesCli,
  runBenchmarkCompareCli,
  runBenchmarkRegisterCli,
  runBenchmarkValidateCli,
  selectBenchmarkBaseline,
  validateBenchmarkArtifacts,
  type BenchmarkReport,
} from "../src/index.ts";

const compareScript = fileURLToPath(new URL("../scripts/benchmark-compare.mjs", import.meta.url));
const baselinesScript = fileURLToPath(new URL("../scripts/benchmark-baselines.mjs", import.meta.url));
const registerScript = fileURLToPath(new URL("../scripts/benchmark-register.mjs", import.meta.url));
const validateScript = fileURLToPath(new URL("../scripts/benchmark-validate.mjs", import.meta.url));

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

test("benchmark comparison can select matching baselines from a manifest", async () => {
  await using fixture = await tempFixture();
  const baseline = join(fixture.path, "baseline.json");
  const other = join(fixture.path, "other.json");
  const candidate = join(fixture.path, "candidate.json");
  const manifest = join(fixture.path, "index.json");
  await writeReport(baseline, report({ results: [result("gci", "execute", 100, 1)] }));
  await writeReport(other, report({ stone: "other", results: [result("gci", "execute", 500, 1)] }));
  await writeReport(candidate, report({ results: [result("gci", "execute", 80, 1)] }));
  await writeJson(manifest, { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: ["other.json", "baseline.json"] });

  const comparison = compareBenchmarkCandidateWithManifest({
    candidatePath: candidate,
    manifestPath: manifest,
    maxRegressionPct: 10,
  });

  assert.equal(comparison.baselinePath, baseline);
  assert.equal(comparison.candidatePath, candidate);
  assert.equal(comparison.thresholdExceeded, true);

  await writeJson(manifest, { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: ["other.json"] });
  assert.throws(
    () => compareBenchmarkCandidateWithManifest({ candidatePath: candidate, manifestPath: manifest }),
    /No committed benchmark baseline/,
  );
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

  await writeJson(manifest, { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: [{ path: "first.json", label: "extra" }] });
  assert.throws(() => selectBenchmarkBaseline({ candidateReportPath: candidate, manifestPath: manifest }), /unsupported key: label/);
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
  const manifestPayload = JSON.parse(await readFile(manifest, "utf8"));
  assert.equal(manifestPayload.$schema, BASELINE_MANIFEST_SCHEMA_PATH);
  assert.deepEqual(manifestPayload.baselines, ["baseline-macos-arm64.json"]);

  const duplicate = registerBenchmarkBaseline({
    reportPath: external,
    manifestPath: manifest,
    copyTo: "baseline-macos-arm64.json",
  });
  assert.equal(duplicate.addedToManifest, false);

  const sameMetadata = join(fixture.path, "external", "same-metadata.json");
  await writeReport(sameMetadata, report({ results: [result("gci", "execute", 101, 1)] }));
  assert.throws(
    () => registerBenchmarkBaseline({ reportPath: sameMetadata, manifestPath: manifest, copyTo: "baseline-duplicate.json" }),
    /metadata already exists/,
  );
  assert.throws(
    () => registerBenchmarkBaseline({
      reportPath: sameMetadata,
      manifestPath: manifest,
      copyTo: "baseline-duplicate.json",
      allowDuplicateMetadata: true,
      replaceDuplicateMetadata: true,
    }),
    /cannot both be true/,
  );

  const replaceIo = fakeIo();
  assert.equal(await runBenchmarkRegisterCli([
    sameMetadata,
    "--manifest",
    manifest,
    "--copy-to",
    "baseline-replacement.json",
    "--replace-duplicate-metadata",
    "--json",
  ], replaceIo), 0);
  const replacePayload = JSON.parse(replaceIo.stdoutText());
  assert.equal(replacePayload.registeredPath, "baseline-replacement.json");
  assert.deepEqual(replacePayload.removedDuplicatePaths, ["baseline-macos-arm64.json"]);
  assert.deepEqual(JSON.parse(await readFile(manifest, "utf8")).baselines, ["baseline-replacement.json"]);

  const duplicateAllowedIo = fakeIo();
  assert.equal(await runBenchmarkRegisterCli([
    sameMetadata,
    "--manifest",
    manifest,
    "--copy-to",
    "baseline-duplicate.json",
    "--allow-duplicate-metadata",
    "--json",
  ], duplicateAllowedIo), 0);
  assert.equal(JSON.parse(duplicateAllowedIo.stdoutText()).registeredPath, "baseline-duplicate.json");

  const conflictingFlagsIo = fakeIo();
  assert.equal(await runBenchmarkRegisterCli([
    sameMetadata,
    "--manifest",
    manifest,
    "--copy-to",
    "ignored.json",
    "--allow-duplicate-metadata",
    "--replace-duplicate-metadata",
  ], conflictingFlagsIo), 2);
  assert.match(conflictingFlagsIo.stderrText(), /cannot be used together/);

  await writeJson(manifest, {
    schema_version: BASELINE_MANIFEST_SCHEMA_VERSION,
    baselines: ["baseline-macos-arm64.json", "missing.json", "baseline-macos-arm64.json"],
  });
  const pruned = pruneBenchmarkBaselineManifest({ manifestPath: manifest, removeMissing: true });
  assert.deepEqual(pruned.removedPaths, ["missing.json", "baseline-macos-arm64.json"]);
  assert.deepEqual(JSON.parse(await readFile(manifest, "utf8")).baselines, ["baseline-macos-arm64.json"]);
});

test("benchmark report loading validates row identity and numeric fields", async () => {
  await using fixture = await tempFixture();
  const duplicate = join(fixture.path, "duplicate.json");
  await writeReport(duplicate, report({
    results: [
      result("gci", "execute", 100, 1),
      result("gci", "execute", 110, 1),
    ],
  }));
  assert.throws(() => loadBenchmarkReport(duplicate), /duplicate benchmark result row/);

  const invalid = join(fixture.path, "invalid.json");
  await writeReport(invalid, report({ results: [{ suite: "", operation: "execute", ops_per_second: -1, count: 1 }] }));
  assert.throws(() => loadBenchmarkReport(invalid), /non-empty string suite and operation/);

  const invalidCount = join(fixture.path, "invalid-count.json");
  await writeReport(invalidCount, report({ results: [{ suite: "gci", operation: "execute", ops_per_second: 1, count: 1.5 }] }));
  assert.throws(() => loadBenchmarkReport(invalidCount), /non-negative integer count/);
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

  const manifestCompareIo = fakeIo();
  assert.equal(await runBenchmarkCompareCli([candidate, "--manifest", manifest, "--json", "--max-regression-pct", "10"], manifestCompareIo), 2);
  const manifestComparison = JSON.parse(manifestCompareIo.stdoutText());
  assert.equal(manifestComparison.baselinePath, baseline);
  assert.equal(manifestComparison.thresholdExceeded, true);

  const compareUsageIo = fakeIo();
  assert.equal(await runBenchmarkCompareCli([baseline, candidate, "--manifest", manifest], compareUsageIo), 2);
  assert.match(compareUsageIo.stderrText(), /Expected candidate report path/);

  const baselinesIo = fakeIo();
  assert.equal(await runBenchmarkBaselinesCli([candidate, "--manifest", manifest, "--json"], baselinesIo), 0);
  assert.equal(JSON.parse(baselinesIo.stdoutText()).selectedPath, baseline);

  const registerIo = fakeIo();
  const registeredManifest = join(fixture.path, "registered", "index.json");
  assert.equal(await runBenchmarkRegisterCli([candidate, "--manifest", registeredManifest, "--json"], registerIo), 0);
  assert.equal(JSON.parse(registerIo.stdoutText()).addedToManifest, true);
});

test("benchmark validation validates reports and manifest baselines", async () => {
  await using fixture = await tempFixture();
  const baseline = join(fixture.path, "baseline.json");
  const candidate = join(fixture.path, "candidate.json");
  const manifest = join(fixture.path, "index.json");
  await writeReport(baseline, report({ results: [result("gci", "execute", 100, 1)] }));
  await writeReport(candidate, report({ results: [result("gci", "execute", 90, 1)] }));
  await writeJson(manifest, { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: ["baseline.json"] });

  const validation = validateBenchmarkArtifacts({ reportPaths: [candidate], manifestPath: manifest });
  assert.equal(validation.schemaVersion, BENCHMARK_VALIDATION_SCHEMA_VERSION);
  assert.equal(validation.validatedReportCount, 2);
  assert.equal(validation.validatedManifestEntryCount, 1);
  assert.equal(validation.manifestBaselinePaths[0], baseline);
  assert.deepEqual(validation.duplicateMetadataGroups, []);

  const io = fakeIo();
  assert.equal(await runBenchmarkValidateCli([candidate, "--manifest", manifest, "--json"], io), 0);
  const payload = JSON.parse(io.stdoutText());
  assert.equal(payload.validatedReportCount, 2);
  assert.match(payload.message, /Validated 2 benchmark report/);

  const skipIo = fakeIo();
  assert.equal(await runBenchmarkValidateCli(["--manifest", manifest, "--skip-manifest-reports", "--json"], skipIo), 0);
  assert.equal(JSON.parse(skipIo.stdoutText()).validatedReportCount, 0);

  const usageIo = fakeIo();
  assert.equal(await runBenchmarkValidateCli([], usageIo), 2);
  assert.match(usageIo.stderrText(), /Expected at least one report path/);

  const duplicate = join(fixture.path, "duplicate.json");
  await writeReport(duplicate, report({ results: [result("gci", "execute", 101, 1)] }));
  await writeJson(manifest, { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: ["baseline.json", "duplicate.json"] });
  assert.throws(() => validateBenchmarkArtifacts({ manifestPath: manifest }), /duplicate baseline metadata/);

  const allowIo = fakeIo();
  assert.equal(await runBenchmarkValidateCli(["--manifest", manifest, "--allow-duplicate-metadata", "--json"], allowIo), 0);
  const allowedPayload = JSON.parse(allowIo.stdoutText());
  assert.equal(allowedPayload.duplicateMetadataGroups.length, 1);
  assert.equal(allowedPayload.duplicateMetadataGroups[0].paths.length, 2);
});

test("benchmark CLI scripts print help without file IO", async () => {
  assert.match((await execNode([compareScript, "--help"])).stdout, /gemstone-js-benchmark-compare/);
  assert.match((await execNode([baselinesScript, "--help"])).stdout, /gemstone-js-benchmark-baselines/);
  assert.match((await execNode([registerScript, "--help"])).stdout, /gemstone-js-benchmark-register/);
  assert.match((await execNode([validateScript, "--help"])).stdout, /gemstone-js-benchmark-validate/);
});

test("benchmark artifact schemas track report and manifest versions", async () => {
  const reportSchema = JSON.parse(await readFile(new URL("../schemas/benchmark-report.schema.json", import.meta.url), "utf8"));
  const manifestSchema = JSON.parse(await readFile(new URL("../schemas/benchmark-baseline-manifest.schema.json", import.meta.url), "utf8"));

  assert.equal(reportSchema.properties.schema_version.const, BENCHMARK_REPORT_SCHEMA_VERSION);
  assert.equal(manifestSchema.properties.schema_version.const, BASELINE_MANIFEST_SCHEMA_VERSION);
  assert.equal(reportSchema.$id.endsWith(BENCHMARK_REPORT_SCHEMA_PATH.slice(2)), true);
  assert.equal(manifestSchema.$id.endsWith(BASELINE_MANIFEST_SCHEMA_PATH.slice(2)), true);
  assert.ok(reportSchema.$defs.resultRow.properties.elapsed_seconds);
  assert.equal(manifestSchema.properties.baselines.items.oneOf[1].properties.path.type, "string");
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
