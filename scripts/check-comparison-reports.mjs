#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(SCRIPT_DIR);
const COMPARE_SCRIPT = join(SCRIPT_DIR, "compare.mjs");
const SCHEMA_PATH = "./schemas/comparison-report.schema.json";
const SCHEMA_VERSION = 1;
const TARGETS = ["gemstone-js", "gemstone-rs", "all"];
const VIEWS = ["summary", "scorecard", "gaps", "next", "totals", "batches"];
const SCOPES = ["full", "beta"];
const EXPECTED_TOTALS = {
  full: {
    "gemstone-js": { totalBatches: 6, hoursMin: 42, hoursMax: 72 },
    "gemstone-rs": { totalBatches: 6, hoursMin: 44, hoursMax: 79 },
    all: { totalBatches: 12, hoursMin: 86, hoursMax: 151 },
  },
  beta: {
    "gemstone-js": { totalBatches: 1, hoursMin: 4, hoursMax: 8 },
    "gemstone-rs": { totalBatches: 4, hoursMin: 26, hoursMax: 45 },
    all: { totalBatches: 5, hoursMin: 30, hoursMax: 53 },
  },
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function main() {
  assertSchemaContract();
  let checked = 0;
  for (const scope of SCOPES) {
    for (const target of TARGETS) {
      for (const view of VIEWS) {
        assertReport(target, view, scope, runJson(target, view, scope));
        checked += 1;
      }
    }
  }
  assertHumanOutput();
  assertOutputWrite();
  console.log(`Comparison report check passed: ${checked} JSON reports, schema v${SCHEMA_VERSION}.`);
}

function assertSchemaContract() {
  const schema = JSON.parse(readFileSync(join(PACKAGE_ROOT, "schemas/comparison-report.schema.json"), "utf8"));
  assertEqual(schema.properties?.$schema?.const, SCHEMA_PATH, "comparison schema path const");
  assertEqual(schema.properties?.schema_version?.const, SCHEMA_VERSION, "comparison schema version const");
  for (const target of TARGETS) {
    assertIncludes(schema.properties?.comparison?.enum, target, `schema comparison enum ${target}`);
  }
  for (const view of VIEWS) {
    assertIncludes(schema.properties?.view?.enum, view, `schema view enum ${view}`);
  }
  for (const scope of SCOPES) {
    assertIncludes(schema.properties?.scope?.enum, scope, `schema scope enum ${scope}`);
  }
  for (const definition of ["batch", "gap", "summaryRow", "comparisonEntry"]) {
    if (!schema.$defs?.[definition]) throw new Error(`comparison schema is missing $defs.${definition}.`);
  }
}

function assertReport(target, view, scope, report) {
  assertEqual(report.$schema, SCHEMA_PATH, `${target}/${view} $schema`);
  assertEqual(report.schema_version, SCHEMA_VERSION, `${target}/${view} schema_version`);
  assertEqual(report.comparison, target, `${target}/${view} comparison`);
  assertEqual(report.scope, scope, `${target}/${view} scope`);
  assertEqual(report.view, view, `${target}/${view} view`);
  assertNonEmptyString(report.title, `${target}/${view} title`);
  assertNonEmptyString(report.answer, `${target}/${view} answer`);
  if (report.fullGuide && !existsSync(join(PACKAGE_ROOT, report.fullGuide))) {
    throw new Error(`${target}/${view} fullGuide does not exist: ${report.fullGuide}`);
  }

  if (view === "totals" || view === "batches" || view === "scorecard") {
    assertTotals(target, view, scope, report);
  }
  if (target === "all") {
    assertArray(report.comparisons, `${target}/${view} comparisons`);
    for (const comparison of report.comparisons) {
      assertIncludes(["gemstone-js", "gemstone-rs"], comparison.comparison, `${target}/${view} comparison entry`);
      assertEqual(comparison.scope, scope, `${target}/${view} ${comparison.comparison} scope`);
      if ("totalBatches" in comparison) assertTotals(comparison.comparison, view, scope, comparison);
      if (comparison.batch) assertBatch(comparison.batch, `${target}/${view} ${comparison.comparison} batch`);
      if (comparison.gap) assertGap(comparison.gap, `${target}/${view} ${comparison.comparison} gap`);
      if (comparison.batches) comparison.batches.forEach((batch, index) => assertBatch(batch, `${target}/${view} ${comparison.comparison} batches[${index}]`));
      if (comparison.gaps) comparison.gaps.forEach((gap, index) => assertGap(gap, `${target}/${view} ${comparison.comparison} gaps[${index}]`));
    }
    return;
  }

  assertNonEmptyString(report.fullGuide, `${target}/${view} fullGuide`);
  if (view === "summary") {
    assertArray(report.rows, `${target}/${view} rows`);
    for (const row of report.rows) {
      assertNonEmptyString(row.topic, `${target}/${view} row topic`);
      assertNonEmptyString(row.gemstonePy, `${target}/${view} row gemstonePy`);
      assertNonEmptyString(row.project, `${target}/${view} row project`);
      assertNonEmptyString(row.recommendation, `${target}/${view} row recommendation`);
    }
  } else if (view === "gaps") {
    assertArray(report.gaps, `${target}/${view} gaps`);
    report.gaps.forEach((gap, index) => assertGap(gap, `${target}/${view} gaps[${index}]`));
  } else if (view === "next") {
    assertBatch(report.batch, `${target}/${view} batch`);
    assertGap(report.gap, `${target}/${view} gap`);
  } else if (view === "batches") {
    assertArray(report.batches, `${target}/${view} batches`);
    report.batches.forEach((batch, index) => assertBatch(batch, `${target}/${view} batches[${index}]`));
  } else if (view === "scorecard") {
    assertBatch(report.nextBatch, `${target}/${view} nextBatch`);
    assertGap(report.topGap, `${target}/${view} topGap`);
    for (const field of ["gemstonePyUseWhen", "projectUseWhen", "gemstonePyStrengths", "projectStrengths"]) {
      assertArray(report[field], `${target}/${view} ${field}`);
    }
  }
}

function assertTotals(target, view, scope, report) {
  const expected = EXPECTED_TOTALS[scope][target];
  assertEqual(report.totalBatches, expected.totalBatches, `${target}/${view} totalBatches`);
  assertEqual(report.hoursMin, expected.hoursMin, `${target}/${view} hoursMin`);
  assertEqual(report.hoursMax, expected.hoursMax, `${target}/${view} hoursMax`);
}

function assertBatch(batch, label) {
  if (!batch || typeof batch !== "object") throw new Error(`${label} must be an object.`);
  if (!Number.isInteger(batch.number) || batch.number < 1) throw new Error(`${label}.number must be a positive integer.`);
  if (!Number.isInteger(batch.hoursMin) || !Number.isInteger(batch.hoursMax) || batch.hoursMin > batch.hoursMax) {
    throw new Error(`${label} must have valid hour bounds.`);
  }
  assertNonEmptyString(batch.focus, `${label}.focus`);
  assertNonEmptyString(batch.outcome, `${label}.outcome`);
  assertNonEmptyString(batch.verifyWith, `${label}.verifyWith`);
}

function assertGap(gap, label) {
  if (!gap || typeof gap !== "object") throw new Error(`${label} must be an object.`);
  for (const field of ["priority", "area", "gemstonePyStrength", "projectGap", "nextAction", "verifyWith"]) {
    assertNonEmptyString(gap[field], `${label}.${field}`);
  }
}

function assertHumanOutput() {
  const jsScorecard = runText("gemstone-js", "scorecard");
  for (const snippet of ["gemstone-js vs gemstone-py", "42-72 hours", "Native publish confidence"]) {
    if (!jsScorecard.includes(snippet)) throw new Error(`gemstone-js scorecard is missing ${JSON.stringify(snippet)}.`);
  }
  const jsBetaTotals = runText("gemstone-js", "totals", "beta");
  for (const snippet of ["Scope: beta", "1 batch", "4-8 hours"]) {
    if (!jsBetaTotals.includes(snippet)) throw new Error(`gemstone-js beta totals output is missing ${JSON.stringify(snippet)}.`);
  }
  const allTotals = runText("all", "totals");
  for (const snippet of ["Combined total", "12 batches", "86-151 hours"]) {
    if (!allTotals.includes(snippet)) throw new Error(`combined totals output is missing ${JSON.stringify(snippet)}.`);
  }
  const explicitFlagReport = JSON.parse(execFileSync(process.execPath, [
    COMPARE_SCRIPT,
    "--target",
    "js",
    "--scope",
    "full",
    "--view",
    "totals",
    "--json",
    "--assert-total-batches",
    "6",
    "--assert-hours-min",
    "42",
    "--assert-hours-max",
    "72",
    "--max-total-batches",
    "6",
    "--max-hours-max",
    "72",
  ], { encoding: "utf8" }));
  assertEqual(explicitFlagReport.comparison, "gemstone-js", "explicit --target report comparison");
  assertEqual(explicitFlagReport.view, "totals", "explicit --view report view");
  assertEqual(explicitFlagReport.scope, "full", "explicit --scope report scope");
  assertTotals("gemstone-js", "totals", "full", explicitFlagReport);
  const betaFlagReport = JSON.parse(execFileSync(process.execPath, [
    COMPARE_SCRIPT,
    "--target",
    "js",
    "--scope",
    "beta",
    "--view",
    "totals",
    "--json",
    "--assert-total-batches",
    "1",
    "--max-hours-max",
    "8",
  ], { encoding: "utf8" }));
  assertEqual(betaFlagReport.scope, "beta", "explicit beta --scope report scope");
  assertTotals("gemstone-js", "totals", "beta", betaFlagReport);
  assertAssertionFailure();
  assertQuietThresholdCheck();

  const markdown = execFileSync(process.execPath, [
    COMPARE_SCRIPT,
    "gemstone-js",
    "scorecard",
    "--markdown",
  ], { encoding: "utf8" });
  for (const snippet of ["# gemstone-js vs gemstone-py", "## Next Batch", "**6 batches**", "### 1. Native publish confidence"]) {
    if (!markdown.includes(snippet)) throw new Error(`Markdown comparison output is missing ${JSON.stringify(snippet)}.`);
  }
}

function assertAssertionFailure() {
  try {
    execFileSync(process.execPath, [
      COMPARE_SCRIPT,
      "--target",
      "js",
      "--view",
      "totals",
      "--assert-total-batches",
      "99",
    ], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    if (!stderr.includes("assertion failed")) {
      throw new Error(`comparison assertion failure did not explain the mismatch:\n${stderr}`);
    }
    return;
  }
  throw new Error("comparison assertion failure command unexpectedly passed.");
}

function assertQuietThresholdCheck() {
  const quietOutput = execFileSync(process.execPath, [
    COMPARE_SCRIPT,
    "--target",
    "js",
    "--view",
    "totals",
    "--max-total-batches",
    "6",
    "--max-hours-min",
    "42",
    "--max-hours-max",
    "72",
    "--quiet",
  ], { encoding: "utf8" });
  if (quietOutput !== "") {
    throw new Error(`quiet comparison threshold check unexpectedly wrote output:\n${quietOutput}`);
  }
  try {
    execFileSync(process.execPath, [
      COMPARE_SCRIPT,
      "--target",
      "js",
      "--view",
      "totals",
      "--max-hours-max",
      "10",
      "--quiet",
    ], { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    if (!stderr.includes("maximum threshold failed")) {
      throw new Error(`comparison maximum-threshold failure did not explain the mismatch:\n${stderr}`);
    }
    return;
  }
  throw new Error("comparison maximum-threshold failure command unexpectedly passed.");
}

function assertOutputWrite() {
  const tempRoot = mkdtempSync(join(tmpdir(), "gemstone-js-compare-"));
  try {
    const jsonPath = join(tempRoot, "reports", "gemstone-js-scorecard.json");
    const jsonMessage = execFileSync(process.execPath, [
      COMPARE_SCRIPT,
      "gemstone-js",
      "scorecard",
      "--json",
      "--output",
      jsonPath,
    ], { encoding: "utf8" });
    if (!jsonMessage.includes("Wrote comparison report")) {
      throw new Error("comparison --output JSON command did not report the written path.");
    }
    const jsonReport = JSON.parse(readFileSync(jsonPath, "utf8"));
    assertEqual(jsonReport.$schema, SCHEMA_PATH, "written JSON report $schema");
    assertEqual(jsonReport.comparison, "gemstone-js", "written JSON report comparison");
    assertEqual(jsonReport.view, "scorecard", "written JSON report view");

    const textPath = join(tempRoot, "reports", "gemstone-js-totals.txt");
    execFileSync(process.execPath, [
      COMPARE_SCRIPT,
      "gemstone-js",
      "totals",
      "--output",
      textPath,
    ], { encoding: "utf8" });
    const textReport = readFileSync(textPath, "utf8");
    for (const snippet of ["gemstone-js remaining work vs gemstone-py", "6 batches", "42-72 hours"]) {
      if (!textReport.includes(snippet)) {
        throw new Error(`written text comparison report is missing ${JSON.stringify(snippet)}.`);
      }
    }
    const markdownPath = join(tempRoot, "reports", "gemstone-js-scorecard.md");
    execFileSync(process.execPath, [
      COMPARE_SCRIPT,
      "gemstone-js",
      "scorecard",
      "--format",
      "markdown",
      "--output",
      markdownPath,
    ], { encoding: "utf8" });
    const markdownReport = readFileSync(markdownPath, "utf8");
    for (const snippet of ["# gemstone-js vs gemstone-py", "## Next Batch", "### 1. Native publish confidence"]) {
      if (!markdownReport.includes(snippet)) {
        throw new Error(`written Markdown comparison report is missing ${JSON.stringify(snippet)}.`);
      }
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runJson(target, view, scope = "full") {
  return JSON.parse(execFileSync(process.execPath, [COMPARE_SCRIPT, target, view, "--scope", scope, "--json"], { encoding: "utf8" }));
}

function runText(target, view, scope = "full") {
  return execFileSync(process.execPath, [COMPARE_SCRIPT, target, view, "--scope", scope], { encoding: "utf8" });
}

function assertArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array.`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}.`);
  }
}

function assertIncludes(values, value, label) {
  if (!Array.isArray(values) || !values.includes(value)) {
    throw new Error(`${label} is missing ${JSON.stringify(value)}.`);
  }
}
