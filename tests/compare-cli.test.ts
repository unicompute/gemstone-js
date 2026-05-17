import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const compareScript = fileURLToPath(new URL("../scripts/compare.mjs", import.meta.url));

test("comparison CLI reports gemstone-rs batch totals", async () => {
  const output = await execNode([compareScript, "gemstone-rs", "--totals", "--json"]);
  const report = JSON.parse(output.stdout);

  assert.equal(report.comparison, "gemstone-rs");
  assert.equal(report.$schema, "./schemas/comparison-report.schema.json");
  assert.equal(report.schema_version, 1);
  assert.equal(report.scope, "full");
  assert.equal(report.totalBatches, 6);
  assert.equal(report.hoursMin, 44);
  assert.equal(report.hoursMax, 79);
});

test("comparison CLI reports beta hardening scope totals", async () => {
  const output = await execNode([compareScript, "--target", "js", "--scope", "beta", "--view", "totals", "--json"]);
  const report = JSON.parse(output.stdout);

  assert.equal(report.comparison, "gemstone-js");
  assert.equal(report.scope, "beta");
  assert.equal(report.totalBatches, 1);
  assert.equal(report.hoursMin, 4);
  assert.equal(report.hoursMax, 8);
  assert.match(report.answer, /conservative JavaScript beta/);
});

test("comparison CLI reports combined ecosystem batches", async () => {
  const output = await execNode([compareScript, "all", "--batches", "--json"]);
  const report = JSON.parse(output.stdout);

  assert.equal(report.comparison, "all");
  assert.equal(report.$schema, "./schemas/comparison-report.schema.json");
  assert.equal(report.schema_version, 1);
  assert.equal(report.scope, "full");
  assert.equal(report.totalBatches, 12);
  assert.equal(report.hoursMin, 86);
  assert.equal(report.hoursMax, 151);
  assert.equal(report.comparisons.length, 2);
  assert.equal(report.comparisons.find((entry: { comparison: string }) => entry.comparison === "gemstone-js")?.totalBatches, 6);
  assert.equal(report.comparisons.find((entry: { comparison: string }) => entry.comparison === "gemstone-rs")?.totalBatches, 6);
});

test("comparison CLI prints scorecard and help text", async () => {
  assert.match((await execNode([compareScript, "rust", "--scorecard"])).stdout, /gemstone-rs scorecard|gemstone-rs vs gemstone-py/);
  assert.match((await execNode([compareScript, "--help"])).stdout, /gemstone-js-compare/);
});

test("comparison report schema tracks CLI JSON shape", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/comparison-report.schema.json", import.meta.url), "utf8"));
  const output = await execNode([compareScript, "gemstone-js", "--scorecard", "--json"]);
  const report = JSON.parse(output.stdout);

  assert.equal(report.fullGuide, "docs/gemstone-js-vs-gemstone-py.md");
  assert.equal(schema.properties.schema_version.const, report.schema_version);
  assert.equal(schema.properties.$schema.const, report.$schema);
  assert.equal(schema.properties.scope.enum.includes(report.scope), true);
  assert.equal(schema.properties.comparison.enum.includes(report.comparison), true);
  assert.equal(schema.properties.view.enum.includes(report.view), true);
  assert.ok(schema.$defs.batch.required.includes("verifyWith"));
  assert.ok(schema.$defs.gap.required.includes("nextAction"));
});

test("comparison CLI writes selected reports to output files", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "gemstone-js-compare-test-"));
  try {
    const jsonPath = join(tempRoot, "nested", "scorecard.json");
    const jsonOutput = await execNode([compareScript, "gemstone-js", "--scorecard", "--json", "--output", jsonPath]);
    assert.match(jsonOutput.stdout, /Wrote comparison report/);
    const jsonReport = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.equal(jsonReport.comparison, "gemstone-js");
    assert.equal(jsonReport.view, "scorecard");
    assert.equal(jsonReport.totalBatches, 6);

    const textPath = join(tempRoot, "totals.txt");
    await execNode([compareScript, "gemstone-js", "--totals", "--output", textPath]);
    const textReport = await readFile(textPath, "utf8");
    assert.match(textReport, /6 batches/);
    assert.match(textReport, /42-72 hours/);

    const markdownPath = join(tempRoot, "scorecard.md");
    await execNode([compareScript, "gemstone-js", "--scorecard", "--format", "markdown", "--output", markdownPath]);
    const markdownReport = await readFile(markdownPath, "utf8");
    assert.match(markdownReport, /^# gemstone-js vs gemstone-py/m);
    assert.match(markdownReport, /## Next Batch/);
    assert.match(markdownReport, /### 1\. Native publish confidence/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("comparison CLI prints Markdown reports", async () => {
  const output = await execNode([compareScript, "all", "--batches", "--markdown"]);

  assert.match(output.stdout, /^# GemStone client ecosystem comparison/m);
  assert.match(output.stdout, /Combined total: \*\*12 batches\*\*/);
  assert.match(output.stdout, /## gemstone-js/);
  assert.match(output.stdout, /## gemstone-rs/);
});

test("comparison CLI accepts explicit target and view flags", async () => {
  const output = await execNode([
    compareScript,
    "--target",
    "js",
    "--view",
    "totals",
    "--json",
    "--assert-total-batches",
    "6",
    "--assert-hours-min",
    "42",
    "--assert-hours-max",
    "72",
  ]);
  const report = JSON.parse(output.stdout);

  assert.equal(report.comparison, "gemstone-js");
  assert.equal(report.view, "totals");
  assert.equal(report.totalBatches, 6);

  const markdown = await execNode([compareScript, "--target", "rust", "--view", "scorecard", "--format", "markdown"]);
  assert.match(markdown.stdout, /^# gemstone-rs vs gemstone-py/m);
  assert.match(markdown.stdout, /\*\*6 batches\*\*/);

  const beta = await execNode([
    compareScript,
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
  ]);
  const betaReport = JSON.parse(beta.stdout);
  assert.equal(betaReport.scope, "beta");
  assert.equal(betaReport.totalBatches, 1);
});

test("comparison CLI assertion flags fail on drift", async () => {
  const quiet = await execNode([
    compareScript,
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
  ]);
  assert.equal(quiet.stdout, "");

  await assert.rejects(
    execNode([compareScript, "--target", "js", "--view", "totals", "--assert-hours-max", "999"]),
    /maximum hours assertion failed/,
  );
  await assert.rejects(
    execNode([compareScript, "--target", "js", "--view", "totals", "--max-hours-max", "10"]),
    /maximum hours maximum threshold failed/,
  );
  await assert.rejects(
    execNode([compareScript, "--target", "js", "--view", "summary", "--assert-total-batches", "6"]),
    /Assertions require a report view with totals/,
  );
});

function execNode(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}
