import { arch, platform } from "node:os";
import { writeFileSync } from "node:fs";
import { GSCollection } from "./query.ts";
import { GStore, type GStoreJsonValue } from "./gstore.ts";
import { PersistentRoot } from "./persistent-root.ts";
import { Session, type GemStoneArgument } from "./client.ts";
import { oopToSmallint, smallintToOop } from "./oop.ts";
import {
  BENCHMARK_REPORT_SCHEMA_VERSION,
  type BenchmarkReport,
  type BenchmarkResultRow,
} from "./benchmark-baselines.ts";

export const DEFAULT_BENCHMARK_ENTRIES = 200;
export const DEFAULT_BENCHMARK_SEARCH_RUNS = 10;
export const DEFAULT_BENCHMARK_SUITES = ["gci", "persistent_root", "gscollection", "gstore", "rchash"] as const;
export const OFFLINE_BENCHMARK_SUITES = ["gci"] as const;

export type BenchmarkSuiteName = typeof DEFAULT_BENCHMARK_SUITES[number];
export type BenchmarkSessionFactory = () => Promise<Session>;

export interface BenchmarkRunOptions {
  suites?: readonly BenchmarkSuiteName[];
  entries?: number;
  searchRuns?: number;
  sessionFactory?: BenchmarkSessionFactory;
}

export interface BenchmarkReportOptions extends Required<Pick<BenchmarkRunOptions, "entries" | "searchRuns">> {
  suites: readonly BenchmarkSuiteName[];
  results: readonly BenchmarkResultRow[];
  stone?: string;
  host?: string;
  gciBackend?: string;
}

export interface BenchmarksCliIo {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  connect(): Promise<Session>;
}

interface BenchmarksCliOptions {
  help: boolean;
  suites: BenchmarkSuiteName[];
  entries: number;
  searchRuns: number;
  json: boolean;
  output?: string;
}

type Measured<T> = { result: BenchmarkResultRow; value: T };

export class BenchmarkRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkRunError";
  }
}

export class BenchmarksCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarksCliUsageError";
  }
}

export async function runBenchmarkSuite(options: BenchmarkRunOptions = {}): Promise<BenchmarkResultRow[]> {
  const entries = normalizePositiveInteger(options.entries ?? DEFAULT_BENCHMARK_ENTRIES, "entries");
  const searchRuns = normalizePositiveInteger(options.searchRuns ?? DEFAULT_BENCHMARK_SEARCH_RUNS, "searchRuns");
  const suites = normalizeSuites(options.suites ?? DEFAULT_BENCHMARK_SUITES);
  const results: BenchmarkResultRow[] = [];
  for (const suite of suites) {
    if (suite === "gci") results.push(...await benchmarkGci({ entries }));
    else {
      if (!options.sessionFactory) throw new BenchmarkRunError(`Benchmark suite ${suite} requires a live GemStone session.`);
      const session = await options.sessionFactory();
      try {
        if (suite === "persistent_root") results.push(...await benchmarkPersistentRoot(session, entries));
        else if (suite === "gscollection") results.push(...await benchmarkGsCollection(session, entries, searchRuns));
        else if (suite === "gstore") results.push(...await benchmarkGStore(session, entries));
        else if (suite === "rchash") results.push(...await benchmarkRcHash(session, entries));
      } finally {
        await session.logout().catch(() => undefined);
      }
    }
  }
  return results;
}

export function buildBenchmarkReport(options: BenchmarkReportOptions): BenchmarkReport {
  return {
    schema_version: BENCHMARK_REPORT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    runtime: "node",
    node_version: (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node ?? "unknown",
    platform: `${platform()}-${arch()}`,
    gci_backend: options.gciBackend ?? "typescript",
    stone: options.stone ?? "offline",
    host: options.host ?? "local",
    entries: options.entries,
    search_runs: options.searchRuns,
    suites: [...options.suites],
    results: [...options.results],
  };
}

export function formatBenchmarkResults(results: readonly BenchmarkResultRow[]): string {
  if (results.length === 0) return "No benchmark results.\n";
  const suiteWidth = width("Suite", results.map((result) => result.suite));
  const operationWidth = width("Operation", results.map((result) => result.operation));
  const countWidth = width("Count", results.map((result) => result.count.toString()));
  const elapsedWidth = width("Elapsed", results.map((result) => `${(result.elapsed_seconds ?? 0).toFixed(4)}s`));
  const opsWidth = width("Ops/s", results.map((result) => result.ops_per_second.toFixed(1)));
  const noteWidth = width("Note", results.map((result) => result.note ?? ""));
  const lines = [
    `${"Suite".padEnd(suiteWidth)}  ${"Operation".padEnd(operationWidth)}  ${"Count".padStart(countWidth)}  ${"Elapsed".padStart(elapsedWidth)}  ${"Ops/s".padStart(opsWidth)}  ${"Note".padEnd(noteWidth)}`,
    `${"-".repeat(suiteWidth)}  ${"-".repeat(operationWidth)}  ${"-".repeat(countWidth)}  ${"-".repeat(elapsedWidth)}  ${"-".repeat(opsWidth)}  ${"-".repeat(noteWidth)}`,
  ];
  for (const result of results) {
    lines.push(
      `${result.suite.padEnd(suiteWidth)}  ${result.operation.padEnd(operationWidth)}  ${result.count.toString().padStart(countWidth)}  ${`${(result.elapsed_seconds ?? 0).toFixed(4)}s`.padStart(elapsedWidth)}  ${result.ops_per_second.toFixed(1).padStart(opsWidth)}  ${(result.note ?? "").padEnd(noteWidth)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function selectedBenchmarkSuitesRequireLive(suites: readonly BenchmarkSuiteName[]): boolean {
  return suites.some((suite) => !OFFLINE_BENCHMARK_SUITES.includes(suite as typeof OFFLINE_BENCHMARK_SUITES[number]));
}

export async function runBenchmarksCli(argv: readonly string[], io: BenchmarksCliIo): Promise<number> {
  let options: BenchmarksCliOptions;
  try {
    options = parseBenchmarksCliArgs(argv);
  } catch (error) {
    io.stderr.write(`${errorMessage(error)}\n\n${benchmarksCliUsage()}`);
    return 2;
  }
  if (options.help) {
    io.stdout.write(benchmarksCliUsage());
    return 0;
  }

  try {
    const requiresLive = selectedBenchmarkSuitesRequireLive(options.suites);
    let metadata: Pick<BenchmarkReportOptions, "stone" | "host" | "gciBackend"> = {};
    const results = await runBenchmarkSuite({
      suites: options.suites,
      entries: options.entries,
      searchRuns: options.searchRuns,
      sessionFactory: requiresLive
        ? async () => {
            const session = await io.connect();
            metadata = {
              stone: session.config.stone,
              host: session.config.host,
              gciBackend: session.runtime.name,
            };
            return session;
          }
        : undefined,
    });
    const report = buildBenchmarkReport({
      suites: options.suites,
      entries: options.entries,
      searchRuns: options.searchRuns,
      results,
      ...metadata,
    });
    const output = options.json ? `${JSON.stringify(report, null, 2)}\n` : formatBenchmarkResults(report.results);
    if (options.output) writeFileSync(options.output, output, "utf8");
    else io.stdout.write(output);
    return 0;
  } catch (error) {
    io.stderr.write(`gemstone-js-benchmarks: ${errorMessage(error)}\n`);
    return 1;
  }
}

export function benchmarksCliUsage(): string {
  return [
    "Usage: gemstone-js-benchmarks [options]",
    "",
    `Suites: ${DEFAULT_BENCHMARK_SUITES.join(", ")}`,
    "",
    "Options:",
    "  --suite <name>          Select one suite. Repeat to select multiple suites.",
    "  --entries <count>       Workload entry count.",
    "  --search-runs <count>   Search repetition count for gscollection.",
    "  --json                  Emit a JSON benchmark report.",
    "  --output <path>         Write output to a file.",
    "",
  ].join("\n");
}

async function benchmarkGci(options: { entries: number }): Promise<BenchmarkResultRow[]> {
  const measured = await measure("gci", "smallint_roundtrip", options.entries, () => {
    let checksum = 0n;
    for (let index = 0; index < options.entries; index += 1) {
      const value = BigInt((index % 200_001) - 100_000);
      checksum += oopToSmallint(smallintToOop(value));
    }
    return checksum;
  });
  return [{ ...measured.result, note: `checksum=${measured.value.toString()}` }];
}

async function benchmarkPersistentRoot(session: Session, entries: number): Promise<BenchmarkResultRow[]> {
  const root = PersistentRoot.userGlobals(session);
  const key = uniqueGlobalName("BenchmarkPersistentRoot");
  const payload = payloads(entries);
  const results: BenchmarkResultRow[] = [];
  try {
    const write = await measure("persistent_root", "write_mapping_commit", entries, async () => {
      await root.setDict(key, payload);
      await session.commit();
    });
    results.push(write.result);

    await session.abort();
    const dict = await root.requireDict(key);
    const keys = await measure("persistent_root", "mapping_keys", entries, () => dict.keys());
    if (keys.value.length !== entries) throw new BenchmarkRunError(`PersistentRoot benchmark expected ${entries} keys, got ${keys.value.length}`);
    results.push(keys.result);
    return results;
  } finally {
    await session.abort().catch(() => undefined);
    await root.remove(key).catch(() => false);
    await session.commit().catch(() => undefined);
  }
}

async function benchmarkGStore(session: Session, entries: number): Promise<BenchmarkResultRow[]> {
  const name = `benchmark-${uniqueId()}.db`;
  const store = await GStore.open(session, name);
  const payload = jsonPayloads(entries);
  const results: BenchmarkResultRow[] = [];
  try {
    const write = await measure("gstore", "batch_write", entries, async () => {
      await store.transaction((txn) => {
        txn.setAll(payload);
      });
    });
    results.push(write.result);

    const read = await measure("gstore", "snapshot_read", entries, async () => {
      const snapshot = await store.transaction((txn) => txn.toObject(), { readOnly: true });
      return snapshot ? Object.keys(snapshot).length : 0;
    });
    if (read.value !== entries) throw new BenchmarkRunError(`GStore benchmark read ${read.value} rows, expected ${entries}`);
    results.push(read.result);
    return results;
  } finally {
    await GStore.remove(session, name).catch(() => false);
    await session.commit().catch(() => undefined);
  }
}

async function benchmarkRcHash(session: Session, entries: number): Promise<BenchmarkResultRow[]> {
  const root = PersistentRoot.userGlobals(session);
  const key = uniqueGlobalName("BenchmarkRCHash");
  const rcHash = await session.rcKeyValueDictionary();
  const results: BenchmarkResultRow[] = [];
  try {
    await root.setOop(key, rcHash.oop);
    await session.commit();
    const populate = await measure("rchash", "populate_commit", entries, async () => {
      const values: Record<string, GemStoneArgument> = {};
      for (let index = 0; index < entries; index += 1) values[`key:${index}`] = index;
      await rcHash.setAll(values);
      await session.commit();
    });
    results.push(populate.result);

    await session.abort();
    const committed = session.wrapRcKeyValueDictionary(await root.requireOop(key));
    const items = await measure("rchash", "items", entries, () => committed.items());
    if (items.value.length !== entries) throw new BenchmarkRunError(`RCHash benchmark fetched ${items.value.length} rows, expected ${entries}`);
    results.push(items.result);
    return results;
  } finally {
    await session.abort().catch(() => undefined);
    await root.remove(key).catch(() => false);
    await session.commit().catch(() => undefined);
  }
}

async function benchmarkGsCollection(session: Session, entries: number, searchRuns: number): Promise<BenchmarkResultRow[]> {
  const name = uniqueGlobalName("BenchmarkGSCollection");
  const collection = new GSCollection(session, name);
  const values = Array.from({ length: entries }, (_value, index) => `item-${index % Math.max(searchRuns, 1)}`);
  const results: BenchmarkResultRow[] = [];
  try {
    const collectionOop = await session.execute("OrderedCollection new");
    await session.globalSetOop(name, collectionOop);
    const add = await measure("gscollection", "bulk_add_commit", entries, async () => {
      await collection.addAll(values);
      await session.commit();
    });
    results.push(add.result);

    await session.abort();
    const allValues = await measure("gscollection", "all_values", entries, () => collection.allValues());
    if (allValues.value.length !== entries) throw new BenchmarkRunError(`GSCollection allValues benchmark fetched ${allValues.value.length} rows, expected ${entries}`);
    results.push(allValues.result);

    const limit = await measure("gscollection", "limit_values", searchRuns, async () => {
      let matched = 0;
      for (let index = 0; index < searchRuns; index += 1) {
        matched += (await collection.limitValues("yourself", "=", `item-${index}`, 1)).length;
      }
      return matched;
    });
    results.push({ ...limit.result, note: `matched=${limit.value}` });

    const iter = await measure("gscollection", "iter_stream_count", entries, async () => {
      let count = 0;
      for await (const _value of collection.iterValues(128)) count += 1;
      return count;
    });
    if (iter.value !== entries) throw new BenchmarkRunError(`GSCollection iter benchmark streamed ${iter.value} rows, expected ${entries}`);
    results.push({ ...iter.result, note: `rows=${iter.value}` });
    return results;
  } finally {
    await session.abort().catch(() => undefined);
    await session.globalDelete(name).catch(() => false);
    await session.commit().catch(() => undefined);
  }
}

async function measure<T>(
  suite: string,
  operation: string,
  count: number,
  fn: () => T | Promise<T>,
): Promise<Measured<T>> {
  const started = performance.now();
  const value = await fn();
  const elapsed = Math.max((performance.now() - started) / 1000, 1e-12);
  return {
    value,
    result: {
      suite,
      operation,
      count,
      elapsed_seconds: elapsed,
      ops_per_second: count > 0 ? count / elapsed : 0,
    },
  };
}

function payloads(entries: number): Record<string, Record<string, GemStoneArgument>> {
  const result: Record<string, Record<string, GemStoneArgument>> = {};
  for (let index = 0; index < entries; index += 1) {
    result[`item:${index}`] = {
      id: index,
      name: `item-${index}`,
      active: index % 2 === 0,
      score: index % 97,
    };
  }
  return result;
}

function jsonPayloads(entries: number): Record<string, GStoreJsonValue> {
  const result: Record<string, GStoreJsonValue> = {};
  for (let index = 0; index < entries; index += 1) {
    result[`item:${index}`] = {
      id: index,
      name: `item-${index}`,
      active: index % 2 === 0,
      score: index % 97,
    };
  }
  return result;
}

function parseBenchmarksCliArgs(argv: readonly string[]): BenchmarksCliOptions {
  const options: BenchmarksCliOptions = {
    help: false,
    suites: [],
    entries: DEFAULT_BENCHMARK_ENTRIES,
    searchRuns: DEFAULT_BENCHMARK_SEARCH_RUNS,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--suite") options.suites.push(parseSuite(requiredValue(argv, ++index, arg)));
    else if (arg === "--entries") options.entries = normalizePositiveInteger(Number(requiredValue(argv, ++index, arg)), "entries");
    else if (arg === "--search-runs") options.searchRuns = normalizePositiveInteger(Number(requiredValue(argv, ++index, arg)), "search-runs");
    else if (arg === "--json") options.json = true;
    else if (arg === "--output") options.output = requiredValue(argv, ++index, arg);
    else throw new BenchmarksCliUsageError(`Unexpected argument: ${arg}`);
  }
  if (options.suites.length === 0) options.suites = [...DEFAULT_BENCHMARK_SUITES];
  return options;
}

function parseSuite(value: string): BenchmarkSuiteName {
  if ((DEFAULT_BENCHMARK_SUITES as readonly string[]).includes(value)) return value as BenchmarkSuiteName;
  throw new BenchmarksCliUsageError(`Unknown benchmark suite: ${value}`);
}

function normalizeSuites(values: readonly BenchmarkSuiteName[]): BenchmarkSuiteName[] {
  if (values.length === 0) throw new BenchmarkRunError("At least one benchmark suite is required.");
  return values.map(parseSuite);
}

function normalizePositiveInteger(value: number, field: string): number {
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new BenchmarksCliUsageError(`${field} must be a positive integer`);
}

function requiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) throw new BenchmarksCliUsageError(`${flag} requires a value`);
  return value;
}

function uniqueGlobalName(prefix: string): string {
  return `${prefix}_${uniqueId()}`;
}

function uniqueId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`).replaceAll("-", "_");
}

function width(label: string, values: readonly string[]): number {
  return Math.max(label.length, ...values.map((value) => value.length));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
