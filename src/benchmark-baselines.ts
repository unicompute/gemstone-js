import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const BENCHMARK_REPORT_SCHEMA_VERSION = 1;
export const BENCHMARK_COMPARISON_SCHEMA_VERSION = 1;
export const BASELINE_MANIFEST_SCHEMA_VERSION = 1;
export const BASELINE_SELECTION_SCHEMA_VERSION = 1;
export const BASELINE_REGISTRATION_SCHEMA_VERSION = 1;
export const BASELINE_MAINTENANCE_SCHEMA_VERSION = 1;

export const COMPARABLE_METADATA_FIELDS = [
  "stone",
  "platform",
  "runtime",
  "node_version",
  "python_version",
  "python_implementation",
  "gci_backend",
  "entries",
  "search_runs",
  "suites",
] as const;

export type BenchmarkMetadataField = typeof COMPARABLE_METADATA_FIELDS[number];
export type BenchmarkComparisonStatus = "missing_in_baseline" | "missing_in_candidate" | "improved" | "regressed" | "unchanged";
export type BenchmarkThresholdScope = "global" | "suite" | "operation";

export interface BenchmarkResultRow {
  suite: string;
  operation: string;
  ops_per_second: number;
  count: number;
  elapsed_seconds?: number;
  note?: string;
}

export interface BenchmarkReport {
  schema_version: number;
  results: BenchmarkResultRow[];
  [key: string]: unknown;
}

export interface BenchmarkComparisonRow {
  suite: string;
  operation: string;
  status: BenchmarkComparisonStatus;
  baselineOpsPerSecond: number | null;
  candidateOpsPerSecond: number | null;
  deltaOpsPerSecond: number | null;
  deltaPercent: number | null;
  baselineCount: number | null;
  candidateCount: number | null;
  baselineNote: string | null;
  candidateNote: string | null;
  appliedRegressionPct: number | null;
  thresholdScope: BenchmarkThresholdScope | null;
}

export interface BenchmarkComparisonReport {
  schemaVersion: number;
  baselinePath: string;
  candidatePath: string;
  comparable: boolean;
  compatibilityIssues: string[];
  maxRegressionPct: number | null;
  suiteRegressionPcts: Record<string, number>;
  operationRegressionPcts: Record<string, number>;
  thresholdExceeded: boolean;
  thresholdExceededOperations: string[];
  baselineMetadata: Record<string, unknown>;
  candidateMetadata: Record<string, unknown>;
  baselineGeneratedAt: string | null;
  candidateGeneratedAt: string | null;
  baselineStone: string | null;
  candidateStone: string | null;
  rows: BenchmarkComparisonRow[];
}

export interface CompareBenchmarkReportsOptions {
  baselinePath: string;
  candidatePath: string;
  maxRegressionPct?: number | null;
  suiteRegressionPcts?: Record<string, number>;
  operationRegressionPcts?: Record<string, number>;
}

export interface BaselineSelectionReport {
  schemaVersion: number;
  candidatePath: string;
  manifestPath: string;
  selectedPath: string | null;
  comparable: boolean;
  message: string;
  candidateMetadata: Record<string, unknown>;
  selectedMetadata: Record<string, unknown> | null;
}

export interface BaselineRegistrationReport {
  schemaVersion: number;
  sourceReportPath: string;
  manifestPath: string;
  registeredPath: string;
  copied: boolean;
  addedToManifest: boolean;
  message: string;
}

export interface BaselineManifestMaintenanceReport {
  schemaVersion: number;
  manifestPath: string;
  removedPaths: string[];
  remainingPaths: string[];
  message: string;
}

export interface RegisterBaselineOptions {
  reportPath: string;
  manifestPath: string;
  copyTo?: string | null;
}

export interface PruneBaselineManifestOptions {
  manifestPath: string;
  dropPaths?: readonly string[];
  removeMissing?: boolean;
}

export interface BenchmarkCliIo {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
}

export class BenchmarkBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkBaselineError";
  }
}

export class BenchmarkCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkCliUsageError";
  }
}

export function loadBenchmarkReport(path: string): BenchmarkReport {
  const payload = loadJson(path);
  if (!isRecord(payload)) throw new BenchmarkBaselineError(`${path} does not contain a JSON object benchmark report`);
  if (payload.schema_version !== BENCHMARK_REPORT_SCHEMA_VERSION) {
    throw new BenchmarkBaselineError(`${path} uses schema_version=${JSON.stringify(payload.schema_version)}; expected ${BENCHMARK_REPORT_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(payload.results)) throw new BenchmarkBaselineError(`${path} is missing a valid 'results' list`);
  return {
    ...payload,
    schema_version: BENCHMARK_REPORT_SCHEMA_VERSION,
    results: payload.results.map((row, index) => normalizeResultRow(row, `${path} results[${index}]`)),
  };
}

export function compareBenchmarkReports(options: CompareBenchmarkReportsOptions): BenchmarkComparisonReport {
  const baselinePath = options.baselinePath;
  const candidatePath = options.candidatePath;
  const baseline = loadBenchmarkReport(baselinePath);
  const candidate = loadBenchmarkReport(candidatePath);
  const baselineIndex = resultIndex(baseline);
  const candidateIndex = resultIndex(candidate);
  const baselineMetadata = metadataSnapshot(baseline);
  const candidateMetadata = metadataSnapshot(candidate);
  const compatibilityIssues = compareMetadata(baselineMetadata, candidateMetadata);
  const comparable = compatibilityIssues.length === 0;
  const suiteThresholds = sortRecord(validateThresholds(options.suiteRegressionPcts ?? {}, "suite"));
  const operationThresholds = sortRecord(validateThresholds(options.operationRegressionPcts ?? {}, "operation"));
  const maxRegressionPct = options.maxRegressionPct ?? null;
  if (maxRegressionPct !== null && (!Number.isFinite(maxRegressionPct) || maxRegressionPct < 0)) {
    throw new BenchmarkBaselineError("maxRegressionPct must be a non-negative number.");
  }

  const keys = [...new Set([...baselineIndex.keys(), ...candidateIndex.keys()])].sort();
  const rows = keys.map((key) => {
    const row = compareRow(key, baselineIndex.get(key) ?? null, candidateIndex.get(key) ?? null);
    const [threshold, scope] = effectiveThreshold(row, maxRegressionPct, suiteThresholds, operationThresholds);
    return { ...row, appliedRegressionPct: threshold, thresholdScope: scope };
  });
  const thresholdExceededOperations = comparable ? exceededOperations(rows) : [];
  return {
    schemaVersion: BENCHMARK_COMPARISON_SCHEMA_VERSION,
    baselinePath,
    candidatePath,
    comparable,
    compatibilityIssues,
    maxRegressionPct,
    suiteRegressionPcts: suiteThresholds,
    operationRegressionPcts: operationThresholds,
    thresholdExceeded: thresholdExceededOperations.length > 0,
    thresholdExceededOperations,
    baselineMetadata,
    candidateMetadata,
    baselineGeneratedAt: optionalString(baseline.generated_at),
    candidateGeneratedAt: optionalString(candidate.generated_at),
    baselineStone: optionalString(baseline.stone),
    candidateStone: optionalString(candidate.stone),
    rows,
  };
}

export function formatBenchmarkComparison(report: BenchmarkComparisonReport): string {
  if (report.rows.length === 0) return "No benchmark comparison rows.\n";

  const suiteWidth = width("Suite", report.rows.map((row) => row.suite));
  const operationWidth = width("Operation", report.rows.map((row) => row.operation));
  const baselineWidth = width("Baseline Ops/s", report.rows.map((row) => formatFloat(row.baselineOpsPerSecond)));
  const candidateWidth = width("Candidate Ops/s", report.rows.map((row) => formatFloat(row.candidateOpsPerSecond)));
  const deltaWidth = width("Delta Ops/s", report.rows.map((row) => formatFloat(row.deltaOpsPerSecond, true)));
  const percentWidth = width("Delta %", report.rows.map((row) => formatFloat(row.deltaPercent, true, "%")));
  const statusWidth = width("Status", report.rows.map((row) => row.status));

  const lines = [
    `Baseline: ${report.baselinePath}`,
    `Candidate: ${report.candidatePath}`,
    `Comparable: ${report.comparable ? "yes" : "no"}`,
  ];
  if (report.compatibilityIssues.length) {
    lines.push("Compatibility Issues:");
    lines.push(...report.compatibilityIssues.map((issue) => `- ${issue}`));
  }
  if (Object.keys(report.suiteRegressionPcts).length) {
    lines.push(`Suite Thresholds: ${Object.entries(report.suiteRegressionPcts).map(([suite, value]) => `${suite}=${value.toFixed(1)}%`).join(", ")}`);
  }
  if (Object.keys(report.operationRegressionPcts).length) {
    lines.push(`Operation Thresholds: ${Object.entries(report.operationRegressionPcts).map(([operation, value]) => `${operation}=${value.toFixed(1)}%`).join(", ")}`);
  }
  if (report.maxRegressionPct !== null) {
    lines.push(report.comparable
      ? `Regression Threshold: ${report.maxRegressionPct.toFixed(1)}% (${report.thresholdExceeded ? "exceeded" : "ok"})`
      : `Regression Threshold: skipped (${report.maxRegressionPct.toFixed(1)}%) due to metadata mismatch`);
    if (report.thresholdExceededOperations.length) {
      lines.push(`Threshold Exceeded Operations: ${report.thresholdExceededOperations.join(", ")}`);
    }
  }

  lines.push(
    `${"Suite".padEnd(suiteWidth)}  ${"Operation".padEnd(operationWidth)}  ${"Baseline Ops/s".padStart(baselineWidth)}  ${"Candidate Ops/s".padStart(candidateWidth)}  ${"Delta Ops/s".padStart(deltaWidth)}  ${"Delta %".padStart(percentWidth)}  ${"Status".padEnd(statusWidth)}`,
    `${"-".repeat(suiteWidth)}  ${"-".repeat(operationWidth)}  ${"-".repeat(baselineWidth)}  ${"-".repeat(candidateWidth)}  ${"-".repeat(deltaWidth)}  ${"-".repeat(percentWidth)}  ${"-".repeat(statusWidth)}`,
  );
  for (const row of report.rows) {
    lines.push(
      `${row.suite.padEnd(suiteWidth)}  ${row.operation.padEnd(operationWidth)}  ${formatFloat(row.baselineOpsPerSecond).padStart(baselineWidth)}  ${formatFloat(row.candidateOpsPerSecond).padStart(candidateWidth)}  ${formatFloat(row.deltaOpsPerSecond, true).padStart(deltaWidth)}  ${formatFloat(row.deltaPercent, true, "%").padStart(percentWidth)}  ${row.status.padEnd(statusWidth)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function selectBenchmarkBaseline(options: { candidateReportPath: string; manifestPath: string }): BaselineSelectionReport {
  const candidatePath = resolve(options.candidateReportPath);
  const manifestPath = resolve(options.manifestPath);
  const candidate = loadBenchmarkReport(candidatePath);
  const candidateMetadata = metadataSnapshot(candidate);
  const matches: Array<{ path: string; metadata: Record<string, unknown> }> = [];
  for (const baselinePath of loadBaselineManifest(manifestPath)) {
    const baseline = loadBenchmarkReport(baselinePath);
    const metadata = metadataSnapshot(baseline);
    if (metadataEqual(metadata, candidateMetadata)) matches.push({ path: baselinePath, metadata });
  }
  if (matches.length === 0) {
    return {
      schemaVersion: BASELINE_SELECTION_SCHEMA_VERSION,
      candidatePath,
      manifestPath,
      selectedPath: null,
      comparable: false,
      message: "No committed benchmark baseline matches the candidate metadata.",
      candidateMetadata,
      selectedMetadata: null,
    };
  }
  if (matches.length > 1) {
    throw new BenchmarkBaselineError(`Multiple benchmark baselines match candidate metadata: ${matches.map((match) => match.path).join(", ")}`);
  }
  return {
    schemaVersion: BASELINE_SELECTION_SCHEMA_VERSION,
    candidatePath,
    manifestPath,
    selectedPath: matches[0].path,
    comparable: true,
    message: "Selected benchmark baseline with matching environment metadata.",
    candidateMetadata,
    selectedMetadata: matches[0].metadata,
  };
}

export function registerBenchmarkBaseline(options: RegisterBaselineOptions): BaselineRegistrationReport {
  const sourceReportPath = resolve(options.reportPath);
  if (!existsSync(sourceReportPath)) throw new BenchmarkBaselineError(`Benchmark report not found: ${sourceReportPath}`);
  loadBenchmarkReport(sourceReportPath);

  const manifestPath = resolve(options.manifestPath);
  mkdirSync(dirname(manifestPath), { recursive: true });
  const payload = loadBaselineManifestPayload(manifestPath);
  const entries = payload.baselines;
  const targetPath = resolveBaselineTarget(sourceReportPath, manifestPath, options.copyTo ?? null);
  const copied = sourceReportPath !== targetPath;
  if (copied) {
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourceReportPath, targetPath);
  }

  const registeredPath = relativeOrAbsolute(targetPath, manifestPath);
  const existing = new Set(entries.map((entry) => entryPathText(entry)));
  const addedToManifest = !existing.has(registeredPath);
  if (addedToManifest) {
    entries.push(registeredPath);
    writeJson(manifestPath, payload);
  }

  let message = "Registered benchmark baseline.";
  if (!addedToManifest && !copied) message = "Benchmark baseline was already registered.";
  else if (!addedToManifest && copied) message = "Updated benchmark baseline artifact without changing the manifest.";
  return {
    schemaVersion: BASELINE_REGISTRATION_SCHEMA_VERSION,
    sourceReportPath,
    manifestPath,
    registeredPath,
    copied,
    addedToManifest,
    message,
  };
}

export function pruneBenchmarkBaselineManifest(options: PruneBaselineManifestOptions): BaselineManifestMaintenanceReport {
  const manifestPath = resolve(options.manifestPath);
  const payload = loadBaselineManifestPayload(manifestPath);
  const dropSet = new Set((options.dropPaths ?? []).map((path) => absoluteEntryPath(path, manifestPath)));
  const removeMissing = options.removeMissing ?? true;
  const removedPaths: string[] = [];
  const remainingPaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const entry of payload.baselines) {
    const pathText = entryPathText(entry);
    const absolutePath = absoluteEntryPath(pathText, manifestPath);
    const shouldRemove = dropSet.has(absolutePath)
      || (removeMissing && !existsSync(absolutePath))
      || seenPaths.has(absolutePath);
    if (shouldRemove) {
      removedPaths.push(pathText);
      continue;
    }
    seenPaths.add(absolutePath);
    remainingPaths.push(pathText);
  }

  if (removedPaths.length) {
    payload.baselines = remainingPaths;
    writeJson(manifestPath, payload);
  }
  return {
    schemaVersion: BASELINE_MAINTENANCE_SCHEMA_VERSION,
    manifestPath,
    removedPaths,
    remainingPaths,
    message: removedPaths.length ? "Updated benchmark baseline manifest entries." : "No benchmark baseline manifest changes were necessary.",
  };
}

export async function runBenchmarkCompareCli(argv: readonly string[], io: BenchmarkCliIo): Promise<number> {
  try {
    const options = parseCompareArgs(argv);
    if (options.help) {
      io.stdout.write(benchmarkCompareUsage());
      return 0;
    }
    const report = compareBenchmarkReports(options);
    const output = options.json ? `${JSON.stringify(report, null, 2)}\n` : formatBenchmarkComparison(report);
    writeCliOutput(options.output, output, io);
    return report.comparable && report.thresholdExceeded ? 2 : 0;
  } catch (error) {
    io.stderr.write(`gemstone-js-benchmark-compare: ${errorMessage(error)}\n`);
    return error instanceof BenchmarkCliUsageError ? 2 : 1;
  }
}

export async function runBenchmarkBaselinesCli(argv: readonly string[], io: BenchmarkCliIo): Promise<number> {
  try {
    const options = parseBaselinesArgs(argv);
    if (options.help) {
      io.stdout.write(benchmarkBaselinesUsage());
      return 0;
    }
    const report = selectBenchmarkBaseline({
      candidateReportPath: options.candidateReport,
      manifestPath: options.manifest,
    });
    const output = options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${report.message}${report.selectedPath ? `\nSelected baseline: ${report.selectedPath}` : ""}\n`;
    writeCliOutput(options.output, output, io);
    return 0;
  } catch (error) {
    io.stderr.write(`gemstone-js-benchmark-baselines: ${errorMessage(error)}\n`);
    return error instanceof BenchmarkCliUsageError ? 2 : 1;
  }
}

export async function runBenchmarkRegisterCli(argv: readonly string[], io: BenchmarkCliIo): Promise<number> {
  try {
    const options = parseRegisterArgs(argv);
    if (options.help) {
      io.stdout.write(benchmarkRegisterUsage());
      return 0;
    }
    let registration: BaselineRegistrationReport | null = null;
    let maintenance: BaselineManifestMaintenanceReport | null = null;
    if (options.report) {
      registration = registerBenchmarkBaseline({
        reportPath: options.report,
        manifestPath: options.manifest,
        copyTo: options.copyTo,
      });
    }
    if (options.pruneMissing || options.dropPaths.length) {
      maintenance = pruneBenchmarkBaselineManifest({
        manifestPath: options.manifest,
        dropPaths: options.dropPaths,
        removeMissing: options.pruneMissing,
      });
    }
    if (!registration && !maintenance) throw new BenchmarkCliUsageError("report is required unless --prune-missing or --drop-path is used.");
    const payload = registration && maintenance ? { registration, maintenance } : (registration ?? maintenance);
    const output = options.json ? `${JSON.stringify(payload, null, 2)}\n` : formatRegistrationOutput(registration, maintenance);
    writeCliOutput(options.output, output, io);
    return 0;
  } catch (error) {
    io.stderr.write(`gemstone-js-benchmark-register: ${errorMessage(error)}\n`);
    return error instanceof BenchmarkCliUsageError ? 2 : 1;
  }
}

function resultIndex(report: BenchmarkReport): Map<string, BenchmarkResultRow> {
  const index = new Map<string, BenchmarkResultRow>();
  for (const row of report.results) index.set(`${row.suite}\0${row.operation}`, row);
  return index;
}

function metadataSnapshot(report: BenchmarkReport): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of COMPARABLE_METADATA_FIELDS) result[field] = normalizeMetadataValue(field, report[field]);
  return result;
}

function normalizeMetadataValue(field: string, value: unknown): unknown {
  if (field === "suites" && Array.isArray(value) && value.every((item) => typeof item === "string")) return [...value].sort();
  return value;
}

function compareMetadata(baseline: Record<string, unknown>, candidate: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const field of COMPARABLE_METADATA_FIELDS) {
    if (metadataEqualValue(baseline[field], candidate[field])) continue;
    issues.push(`${field} differs: baseline=${JSON.stringify(baseline[field])}, candidate=${JSON.stringify(candidate[field])}`);
  }
  return issues;
}

function compareRow(key: string, baseline: BenchmarkResultRow | null, candidate: BenchmarkResultRow | null): BenchmarkComparisonRow {
  const [suite, operation] = key.split("\0");
  const baselineOps = baseline?.ops_per_second ?? null;
  const candidateOps = candidate?.ops_per_second ?? null;
  let deltaOps: number | null = null;
  let deltaPercent: number | null = null;
  let status: BenchmarkComparisonStatus;
  if (!baseline) status = "missing_in_baseline";
  else if (!candidate) status = "missing_in_candidate";
  else {
    deltaOps = candidate.ops_per_second - baseline.ops_per_second;
    deltaPercent = baseline.ops_per_second === 0 ? null : (deltaOps / baseline.ops_per_second) * 100;
    status = deltaOps > 0 ? "improved" : deltaOps < 0 ? "regressed" : "unchanged";
  }
  return {
    suite,
    operation,
    status,
    baselineOpsPerSecond: baselineOps,
    candidateOpsPerSecond: candidateOps,
    deltaOpsPerSecond: deltaOps,
    deltaPercent,
    baselineCount: baseline?.count ?? null,
    candidateCount: candidate?.count ?? null,
    baselineNote: baseline?.note ?? null,
    candidateNote: candidate?.note ?? null,
    appliedRegressionPct: null,
    thresholdScope: null,
  };
}

function effectiveThreshold(
  row: BenchmarkComparisonRow,
  maxRegressionPct: number | null,
  suiteThresholds: Record<string, number>,
  operationThresholds: Record<string, number>,
): [number | null, BenchmarkThresholdScope | null] {
  const operationKey = `${row.suite}/${row.operation}`;
  if (operationKey in operationThresholds) return [operationThresholds[operationKey], "operation"];
  if (row.suite in suiteThresholds) return [suiteThresholds[row.suite], "suite"];
  if (maxRegressionPct !== null) return [maxRegressionPct, "global"];
  return [null, null];
}

function exceededOperations(rows: readonly BenchmarkComparisonRow[]): string[] {
  const exceeded: string[] = [];
  for (const row of rows) {
    const threshold = row.appliedRegressionPct;
    if (threshold === null) continue;
    if (row.status === "missing_in_candidate") {
      exceeded.push(`${row.suite}/${row.operation}`);
      continue;
    }
    if (row.status === "regressed" && row.deltaPercent !== null && Math.abs(row.deltaPercent) >= threshold) {
      exceeded.push(`${row.suite}/${row.operation}`);
    }
  }
  return exceeded;
}

function loadBaselineManifest(path: string): string[] {
  const payload = loadBaselineManifestPayload(path);
  return payload.baselines.map((entry, index) => {
    const text = entryPathText(entry, `${path} baselines[${index}]`);
    const resolved = absoluteEntryPath(text, path);
    if (!existsSync(resolved)) throw new BenchmarkBaselineError(`Baseline report not found: ${resolved}`);
    return resolved;
  });
}

function loadBaselineManifestPayload(path: string): { schema_version: number; baselines: unknown[] } {
  if (!existsSync(path)) return { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: [] };
  const payload = loadJson(path);
  if (!isRecord(payload)) throw new BenchmarkBaselineError(`${path} does not contain a JSON object baseline manifest`);
  if (payload.schema_version !== BASELINE_MANIFEST_SCHEMA_VERSION) {
    throw new BenchmarkBaselineError(`${path} uses schema_version=${JSON.stringify(payload.schema_version)}; expected ${BASELINE_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(payload.baselines)) throw new BenchmarkBaselineError(`${path} is missing a valid 'baselines' list`);
  return { schema_version: BASELINE_MANIFEST_SCHEMA_VERSION, baselines: payload.baselines };
}

function resolveBaselineTarget(sourceReportPath: string, manifestPath: string, copyTo: string | null): string {
  if (copyTo) return isAbsolute(copyTo) ? resolve(copyTo) : resolve(dirname(manifestPath), copyTo);
  return isPathWithin(sourceReportPath, dirname(manifestPath)) ? sourceReportPath : resolve(dirname(manifestPath), sourceReportPath.split(/[\\/]/).pop() ?? "baseline.json");
}

function relativeOrAbsolute(path: string, manifestPath: string): string {
  const relativePath = relative(dirname(manifestPath), path);
  return relativePath.startsWith("..") || isAbsolute(relativePath) ? path : relativePath;
}

function absoluteEntryPath(pathText: string, manifestPath: string): string {
  return isAbsolute(pathText) ? resolve(pathText) : resolve(dirname(manifestPath), pathText);
}

function entryPathText(entry: unknown, label = "Baseline manifest entry"): string {
  if (typeof entry === "string") return entry;
  if (isRecord(entry) && typeof entry.path === "string") return entry.path;
  throw new BenchmarkBaselineError(`${label} must be a string path or object with path.`);
}

function isPathWithin(path: string, directory: string): boolean {
  const relativePath = relative(directory, path);
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function normalizeResultRow(row: unknown, label: string): BenchmarkResultRow {
  if (!isRecord(row)) throw new BenchmarkBaselineError(`${label} must be an object`);
  if (typeof row.suite !== "string" || typeof row.operation !== "string") {
    throw new BenchmarkBaselineError(`${label} must include string suite and operation`);
  }
  if (typeof row.ops_per_second !== "number" || !Number.isFinite(row.ops_per_second)) {
    throw new BenchmarkBaselineError(`${label} must include numeric ops_per_second`);
  }
  if (typeof row.count !== "number" || !Number.isFinite(row.count)) {
    throw new BenchmarkBaselineError(`${label} must include numeric count`);
  }
  return {
    suite: row.suite,
    operation: row.operation,
    ops_per_second: row.ops_per_second,
    count: row.count,
    elapsed_seconds: typeof row.elapsed_seconds === "number" && Number.isFinite(row.elapsed_seconds) ? row.elapsed_seconds : undefined,
    note: typeof row.note === "string" ? row.note : undefined,
  };
}

function parseCompareArgs(argv: readonly string[]): CompareBenchmarkReportsOptions & { help: boolean; json: boolean; output?: string } {
  const options: CompareBenchmarkReportsOptions & { help: boolean; json: boolean; output?: string } = {
    help: false,
    json: false,
    baselinePath: "",
    candidatePath: "",
    suiteRegressionPcts: {},
    operationRegressionPcts: {},
  };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--output") options.output = requiredValue(argv, ++index, arg);
    else if (arg === "--max-regression-pct") options.maxRegressionPct = parseThreshold(requiredValue(argv, ++index, arg), arg);
    else if (arg === "--suite-threshold") {
      const [key, value] = parseThresholdSpec(requiredValue(argv, ++index, arg), "suite");
      options.suiteRegressionPcts![key] = value;
    } else if (arg === "--operation-threshold") {
      const [key, value] = parseThresholdSpec(requiredValue(argv, ++index, arg), "operation");
      options.operationRegressionPcts![key] = value;
    } else if (arg.startsWith("-")) throw new BenchmarkCliUsageError(`Unexpected argument: ${arg}`);
    else positional.push(arg);
  }
  if (!options.help) {
    if (positional.length !== 2) throw new BenchmarkCliUsageError("Expected baseline and candidate report paths.");
    [options.baselinePath, options.candidatePath] = positional;
  }
  return options;
}

function parseBaselinesArgs(argv: readonly string[]): { help: boolean; candidateReport: string; manifest: string; json: boolean; output?: string } {
  const options = { help: false, candidateReport: "", manifest: ".github/benchmarks/index.json", json: false, output: undefined as string | undefined };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--manifest") options.manifest = requiredValue(argv, ++index, arg);
    else if (arg === "--json") options.json = true;
    else if (arg === "--output") options.output = requiredValue(argv, ++index, arg);
    else if (arg.startsWith("-")) throw new BenchmarkCliUsageError(`Unexpected argument: ${arg}`);
    else positional.push(arg);
  }
  if (!options.help) {
    if (positional.length !== 1) throw new BenchmarkCliUsageError("Expected candidate report path.");
    options.candidateReport = positional[0];
  }
  return options;
}

function parseRegisterArgs(argv: readonly string[]): {
  help: boolean;
  report?: string;
  manifest: string;
  copyTo?: string;
  dropPaths: string[];
  pruneMissing: boolean;
  json: boolean;
  output?: string;
} {
  const options = {
    help: false,
    report: undefined as string | undefined,
    manifest: ".github/benchmarks/index.json",
    copyTo: undefined as string | undefined,
    dropPaths: [] as string[],
    pruneMissing: false,
    json: false,
    output: undefined as string | undefined,
  };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--manifest") options.manifest = requiredValue(argv, ++index, arg);
    else if (arg === "--copy-to") options.copyTo = requiredValue(argv, ++index, arg);
    else if (arg === "--drop-path") options.dropPaths.push(requiredValue(argv, ++index, arg));
    else if (arg === "--prune-missing") options.pruneMissing = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--output") options.output = requiredValue(argv, ++index, arg);
    else if (arg.startsWith("-")) throw new BenchmarkCliUsageError(`Unexpected argument: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 1) throw new BenchmarkCliUsageError("Expected at most one report path.");
  options.report = positional[0];
  return options;
}

function benchmarkCompareUsage(): string {
  return [
    "Usage: gemstone-js-benchmark-compare <baseline.json> <candidate.json> [options]",
    "",
    "Options: --json --output <path> --max-regression-pct <pct>",
    "         --suite-threshold <suite=pct> --operation-threshold <suite/op=pct>",
    "",
  ].join("\n");
}

function benchmarkBaselinesUsage(): string {
  return [
    "Usage: gemstone-js-benchmark-baselines <candidate.json> [--manifest <index.json>] [--json] [--output <path>]",
    "",
  ].join("\n");
}

function benchmarkRegisterUsage(): string {
  return [
    "Usage: gemstone-js-benchmark-register [report.json] [options]",
    "",
    "Options: --manifest <index.json> --copy-to <path> --drop-path <path>",
    "         --prune-missing --json --output <path>",
    "",
  ].join("\n");
}

function formatRegistrationOutput(registration: BaselineRegistrationReport | null, maintenance: BaselineManifestMaintenanceReport | null): string {
  const lines: string[] = [];
  if (registration) {
    lines.push(registration.message, `Registered path: ${registration.registeredPath}`);
  }
  if (maintenance) {
    lines.push(maintenance.message);
    if (maintenance.removedPaths.length) lines.push(`Removed paths: ${maintenance.removedPaths.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function writeCliOutput(outputPath: string | undefined, output: string, io: BenchmarkCliIo): void {
  if (outputPath) writeFileSync(outputPath, output, "utf8");
  else io.stdout.write(output);
}

function validateThresholds(values: Record<string, number>, label: string): Record<string, number> {
  for (const [key, value] of Object.entries(values)) {
    if (!key || !Number.isFinite(value) || value < 0) throw new BenchmarkBaselineError(`Invalid ${label} threshold ${key}=${value}`);
  }
  return values;
}

function parseThresholdSpec(spec: string, label: string): [string, number] {
  const [key, rawValue, extra] = spec.split("=");
  if (extra !== undefined || !key || !rawValue) throw new BenchmarkCliUsageError(`Invalid ${label} threshold ${JSON.stringify(spec)}; expected NAME=PCT`);
  return [key.trim(), parseThreshold(rawValue.trim(), `${label} threshold`)];
}

function parseThreshold(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new BenchmarkCliUsageError(`${label} must be a non-negative number`);
  return parsed;
}

function requiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) throw new BenchmarkCliUsageError(`${flag} requires a value`);
  return value;
}

function sortRecord(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

function formatFloat(value: number | null, signed = false, suffix = ""): string {
  if (value === null) return "-";
  const formatted = signed ? `${value >= 0 ? "+" : ""}${value.toFixed(1)}` : value.toFixed(1);
  return `${formatted}${suffix}`;
}

function width(label: string, values: readonly string[]): number {
  return Math.max(label.length, ...values.map((value) => value.length));
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function metadataEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return COMPARABLE_METADATA_FIELDS.every((field) => metadataEqualValue(left[field], right[field]));
}

function metadataEqualValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
