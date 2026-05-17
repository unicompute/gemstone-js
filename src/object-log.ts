import type { Session } from "./client.ts";
import { type Oop } from "./oop.ts";
import {
  decodeEscapedField,
  escapedFieldEncoderSource,
  escapeSmalltalkStringLiteral,
  objectForOopSource,
} from "./smalltalk-source.ts";

export const OBJECT_LOG_LEVELS = {
  fatal: 1,
  error: 2,
  warn: 3,
  info: 4,
  debug: 5,
  trace: 6,
} as const;

export type ObjectLogLevelName = keyof typeof OBJECT_LOG_LEVELS;
export type ObjectLogPriority = typeof OBJECT_LOG_LEVELS[ObjectLogLevelName];

export interface ObjectLogEntry {
  priority: number;
  levelName: string;
  label: string;
  objectRepr: string;
  pid: number;
  timestamp: string;
  index: number;
  tagged: boolean;
  tag: string;
}

export interface ObjectLogAddOptions {
  objectOop?: Oop | { readonly oop: Oop };
}

export interface ObjectLogReadOptions {
  maxEntries?: number;
  level?: ObjectLogLevelName | ObjectLogPriority;
  order?: "oldest" | "newest";
}

export interface ObjectLogFormatOptions {
  includeIndex?: boolean;
  includeTimestamp?: boolean;
  includePid?: boolean;
  includeTag?: boolean;
  includeObject?: boolean;
}

export interface ObjectLogSummary {
  total: number;
  levels: Partial<Record<ObjectLogLevelName | string, number>>;
  tagged: number;
  firstIndex?: number;
  lastIndex?: number;
}

const LEVEL_NAMES = new Map<number, string>(
  Object.entries(OBJECT_LOG_LEVELS).map(([name, priority]) => [priority, name]),
);

const SELECTOR_KEYWORDS: Record<ObjectLogLevelName, string> = {
  fatal: "fatal",
  error: "error",
  warn: "warn",
  info: "info",
  debug: "debug",
  trace: "trace",
};

export class ObjectLog {
  readonly session: Session;

  constructor(session: Session) {
    this.session = session;
  }

  async add(level: ObjectLogLevelName | ObjectLogPriority, label: string, options: ObjectLogAddOptions = {}): Promise<void> {
    const levelName = normalizeLevelName(level);
    const keyword = SELECTOR_KEYWORDS[levelName];
    const escapedLabel = escapeSmalltalkStringLiteral(label);
    const objectSource = options.objectOop === undefined ? "nil" : `(${objectForOopSource(rawOop(options.objectOop))})`;
    await this.session.execute(
      `(ObjectLogEntry ${keyword}: '${escapedLabel}' object: ${objectSource}) addToLog.`,
    );
  }

  async trace(label: string, options: ObjectLogAddOptions = {}): Promise<void> {
    await this.add("trace", label, options);
  }

  async debug(label: string, options: ObjectLogAddOptions = {}): Promise<void> {
    await this.add("debug", label, options);
  }

  async info(label: string, options: ObjectLogAddOptions = {}): Promise<void> {
    await this.add("info", label, options);
  }

  async warn(label: string, options: ObjectLogAddOptions = {}): Promise<void> {
    await this.add("warn", label, options);
  }

  async error(label: string, options: ObjectLogAddOptions = {}): Promise<void> {
    await this.add("error", label, options);
  }

  async fatal(label: string, options: ObjectLogAddOptions = {}): Promise<void> {
    await this.add("fatal", label, options);
  }

  async entries(options: ObjectLogReadOptions = {}): Promise<ObjectLogEntry[]> {
    const read = normalizeObjectLogReadOptions(options);
    const raw = await this.session.eval(objectLogEntriesSource({
      maxEntries: read.maxEntries,
      order: read.order,
      priority: read.priority,
      detectOverflow: read.detectOverflow,
    }));
    const entries = parseObjectLogEntries(raw === null ? "" : String(raw));
    if (entries.length > read.maxEntries) {
      throw new RangeError(`ObjectLog readback exceeded maxEntries ${read.maxEntries}.`);
    }
    return entries;
  }

  async latest(maxEntries: number): Promise<ObjectLogEntry[]> {
    const limit = normalizeObjectLogRequiredMaxEntries(maxEntries, "ObjectLog latest maxEntries");
    return this.entries({ maxEntries: limit, order: "newest" });
  }

  async tail(maxEntries: number): Promise<ObjectLogEntry[]> {
    return this.latest(maxEntries);
  }

  async latestFor(level: ObjectLogLevelName | ObjectLogPriority, maxEntries: number): Promise<ObjectLogEntry[]> {
    const limit = normalizeObjectLogRequiredMaxEntries(maxEntries, "ObjectLog latestFor maxEntries");
    return this.entries({ level, maxEntries: limit, order: "newest" });
  }

  async tailFor(level: ObjectLogLevelName | ObjectLogPriority, maxEntries: number): Promise<ObjectLogEntry[]> {
    return this.latestFor(level, maxEntries);
  }

  async traces(options: ObjectLogReadOptions = {}): Promise<ObjectLogEntry[]> {
    return this.entriesFor("trace", options);
  }

  async debugs(options: ObjectLogReadOptions = {}): Promise<ObjectLogEntry[]> {
    return this.entriesFor("debug", options);
  }

  async infos(options: ObjectLogReadOptions = {}): Promise<ObjectLogEntry[]> {
    return this.entriesFor("info", options);
  }

  async warns(options: ObjectLogReadOptions = {}): Promise<ObjectLogEntry[]> {
    return this.entriesFor("warn", options);
  }

  async errors(options: ObjectLogReadOptions = {}): Promise<ObjectLogEntry[]> {
    return this.entriesFor("error", options);
  }

  async fatals(options: ObjectLogReadOptions = {}): Promise<ObjectLogEntry[]> {
    return this.entriesFor("fatal", options);
  }

  async entriesFor(level: ObjectLogLevelName | ObjectLogPriority, options: ObjectLogReadOptions = {}): Promise<ObjectLogEntry[]> {
    return this.entries({ ...options, level });
  }

  async summarize(options: ObjectLogReadOptions = {}): Promise<ObjectLogSummary> {
    return summarizeObjectLogEntries(await this.entries(options));
  }

  async formatEntries(
    readOptions: ObjectLogReadOptions = {},
    formatOptions: ObjectLogFormatOptions = {},
  ): Promise<string> {
    return formatObjectLogEntries(await this.entries(readOptions), formatOptions);
  }

  async size(): Promise<number> {
    const value = await this.session.eval("ObjectLogEntry objectLog size printString");
    return parseObjectLogCount(value);
  }

  async count(): Promise<number> {
    return this.size();
  }

  async countFor(level: ObjectLogLevelName | ObjectLogPriority): Promise<number> {
    const priority = normalizePriority(level);
    const value = await this.session.eval(objectLogCountForSource(priority));
    return parseObjectLogCount(value);
  }

  async sizeFor(level: ObjectLogLevelName | ObjectLogPriority): Promise<number> {
    return this.countFor(level);
  }

  async isEmpty(): Promise<boolean> {
    return await this.size() === 0;
  }

  async hasEntries(level?: ObjectLogLevelName | ObjectLogPriority): Promise<boolean> {
    if (level === undefined) return !(await this.isEmpty());
    const priority = normalizePriority(level);
    return parseObjectLogBoolean(await this.session.eval(objectLogHasEntriesForSource(priority)));
  }

  async clear(): Promise<void> {
    await this.session.execute("ObjectLogEntry objectLog removeAllSuchThat: [:entry | true].");
  }

  async clearFor(level: ObjectLogLevelName | ObjectLogPriority): Promise<void> {
    const priority = normalizePriority(level);
    await this.session.execute(`ObjectLogEntry objectLog removeAllSuchThat: [:entry | entry priority = ${priority}].`);
  }

  async clearLevel(level: ObjectLogLevelName | ObjectLogPriority): Promise<void> {
    await this.clearFor(level);
  }

  async remove(entry: Pick<ObjectLogEntry, "index">): Promise<void> {
    const index = validateEntryIndex(entry.index) + 1;
    await this.session.execute([
      "| log |",
      "log := ObjectLogEntry objectLog.",
      `(${index} <= log size) ifTrue: [log removeAtIndex: ${index}].`,
    ].join("\n"));
  }

  async delete(entry: Pick<ObjectLogEntry, "index">): Promise<void> {
    await this.remove(entry);
  }

  async removeAll(entries: readonly Pick<ObjectLogEntry, "index">[]): Promise<void> {
    const indexes = normalizeEntryIndexes(entries);
    if (indexes.length === 0) return;
    await this.session.execute([
      "| log indexes |",
      "log := ObjectLogEntry objectLog.",
      `indexes := #(${indexes.map((index) => index + 1).join(" ")}).`,
      "indexes do: [:index | (index <= log size) ifTrue: [log removeAtIndex: index]].",
    ].join("\n"));
  }

  async deleteAll(entries: readonly Pick<ObjectLogEntry, "index">[]): Promise<void> {
    await this.removeAll(entries);
  }
}

export function parseObjectLogEntries(raw: string): ObjectLogEntry[] {
  const entries: ObjectLogEntry[] = [];
  const lines = raw.split("\\q");
  for (let rowIndex = 0; rowIndex < lines.length; rowIndex += 1) {
    const line = lines[rowIndex];
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const priority = parseNonNegativeInteger(decodeEscapedField(parts[0]));
    const pid = parseNonNegativeInteger(decodeEscapedField(parts[3]));
    const tagged = parts[5] === "1";
    const tag = stripPrintStringQuotes(decodeEscapedField(parts[6] ?? ""));
    entries.push({
      priority,
      levelName: LEVEL_NAMES.get(priority) ?? String(priority),
      label: decodeEscapedField(parts[1]),
      objectRepr: decodeEscapedField(parts[2]),
      pid,
      timestamp: decodeEscapedField(parts[4]),
      tagged,
      tag,
      index: parts[7] === undefined ? rowIndex : parseNonNegativeInteger(decodeEscapedField(parts[7])),
    });
  }
  return entries;
}

export function summarizeObjectLogEntries(entries: readonly ObjectLogEntry[]): ObjectLogSummary {
  const levels: ObjectLogSummary["levels"] = {};
  let tagged = 0;
  for (const entry of entries) {
    levels[entry.levelName] = (levels[entry.levelName] ?? 0) + 1;
    if (entry.tagged) tagged += 1;
  }
  return {
    total: entries.length,
    levels,
    tagged,
    firstIndex: entries[0]?.index,
    lastIndex: entries.at(-1)?.index,
  };
}

export function formatObjectLogEntry(entry: ObjectLogEntry, options: ObjectLogFormatOptions = {}): string {
  const prefix: string[] = [];
  if (options.includeIndex !== false) prefix.push(`#${entry.index}`);
  if (options.includeTimestamp) prefix.push(entry.timestamp);
  prefix.push(`[${entry.levelName}]`);

  const details: string[] = [];
  if (options.includePid) details.push(`pid=${entry.pid}`);
  if (options.includeTag !== false && entry.tagged) details.push(`tag=${entry.tag}`);
  if (options.includeObject) details.push(`object=${entry.objectRepr}`);

  const suffix = details.length === 0 ? "" : ` (${details.join(", ")})`;
  return `${prefix.join(" ")} ${entry.label}${suffix}`;
}

export function formatObjectLogEntries(entries: readonly ObjectLogEntry[], options: ObjectLogFormatOptions = {}): string {
  return entries.map((entry) => formatObjectLogEntry(entry, options)).join("\n");
}

interface ObjectLogEntriesSourceOptions {
  maxEntries: number;
  order: "oldest" | "newest";
  priority?: number;
  detectOverflow: boolean;
}

function objectLogEntriesSource(options: ObjectLogEntriesSourceOptions): string {
  const limit = Number.isFinite(options.maxEntries)
    ? options.maxEntries + (options.detectOverflow ? 1 : 0)
    : undefined;
  const indexSource = options.order === "newest" ? "log size - 1" : "0";
  const stepSource = options.order === "newest" ? "-1" : "1";
  const reverseSource = options.order === "newest" ? "true" : "false";
  const limitSource = limit === undefined ? "nil" : String(limit);
  const prioritySource = options.priority === undefined ? "nil" : String(options.priority);
  const usePrioritySource = options.priority === undefined ? "false" : "true";
  return `
    | encode stream log index step count limit priorityFilter usePriority reverse |
    ${escapedFieldEncoderSource("encode")}
    log := ObjectLogEntry objectLog.
    index := ${indexSource}.
    step := ${stepSource}.
    count := 0.
    limit := ${limitSource}.
    priorityFilter := ${prioritySource}.
    usePriority := ${usePrioritySource}.
    reverse := ${reverseSource}.
    stream := ''.
    [
      (index >= 0 and: [index < log size])
        and: [limit isNil or: [count < limit]]
    ] whileTrue: [
      | entry matches objectPrint tagString hasTag row |
      entry := log at: index + 1.
      matches := usePriority
        ifTrue: [entry priority = priorityFilter]
        ifFalse: [true].
      matches ifTrue: [
        objectPrint := [entry object printString] on: Error do: ['nil'].
        hasTag := [entry hasTag] on: Error do: [false].
        tagString := (hasTag and: [entry tag notNil])
          ifTrue: [[entry tag printString] on: Error do: ['']]
          ifFalse: [''].
        row :=
          (encode value: entry priority printString), '|',
          (encode value: (entry label isNil ifTrue: [''] ifFalse: [entry label])), '|',
          (encode value: objectPrint), '|',
          (encode value: entry pid printString), '|',
          (encode value: entry stamp printString), '|',
          (hasTag ifTrue: ['1'] ifFalse: ['0']), '|',
          (encode value: tagString), '|',
          (encode value: index printString), '\\q'.
        stream := reverse
          ifTrue: [row, stream]
          ifFalse: [stream, row].
        count := count + 1
      ].
      index := index + step
    ].
    stream
  `;
}

function objectLogCountForSource(priority: number): string {
  return `
    | count |
    count := 0.
    ObjectLogEntry objectLog do: [:entry |
      entry priority = ${priority} ifTrue: [count := count + 1]].
    count printString
  `;
}

function objectLogHasEntriesForSource(priority: number): string {
  return `(ObjectLogEntry objectLog detect: [:entry | entry priority = ${priority}] ifNone: [nil]) notNil printString`;
}

function normalizeLevelName(level: ObjectLogLevelName | ObjectLogPriority): ObjectLogLevelName {
  if (typeof level === "string") {
    if (level in OBJECT_LOG_LEVELS) return level;
    throw new RangeError(`Unknown ObjectLog level: ${level}`);
  }
  const name = LEVEL_NAMES.get(level);
  if (!name) throw new RangeError(`Unknown ObjectLog priority: ${level}`);
  return name as ObjectLogLevelName;
}

function normalizePriority(level: ObjectLogLevelName | ObjectLogPriority): number {
  return OBJECT_LOG_LEVELS[normalizeLevelName(level)];
}

function rawOop(value: Oop | { readonly oop: Oop }): Oop {
  return typeof value === "bigint" ? value : value.oop;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseObjectLogCount(value: unknown): number {
  const parsed = Number(String(value).trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseObjectLogBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  throw new TypeError(`ObjectLog boolean helper returned ${String(value)}.`);
}

function normalizeObjectLogMaxEntries(value: number | undefined): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("ObjectLog maxEntries must be a non-negative safe integer.");
  }
  return value;
}

function normalizeObjectLogReadOptions(options: ObjectLogReadOptions): Required<Pick<ObjectLogReadOptions, "order">> & {
  maxEntries: number;
  priority?: number;
  detectOverflow: boolean;
} {
  const maxEntries = normalizeObjectLogMaxEntries(options.maxEntries);
  const order = normalizeObjectLogReadOrder(options.order);
  return {
    maxEntries,
    order,
    priority: options.level === undefined ? undefined : normalizePriority(options.level),
    detectOverflow: order === "oldest",
  };
}

function normalizeObjectLogReadOrder(value: ObjectLogReadOptions["order"]): "oldest" | "newest" {
  if (value === undefined || value === "oldest" || value === "newest") return value ?? "oldest";
  throw new RangeError(`ObjectLog read order must be "oldest" or "newest", got ${String(value)}.`);
}

function normalizeObjectLogRequiredMaxEntries(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function validateEntryIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("ObjectLog entry index must be a non-negative safe integer.");
  }
  return value;
}

function normalizeEntryIndexes(entries: readonly Pick<ObjectLogEntry, "index">[]): number[] {
  const values = new Set<number>();
  for (const entry of entries) values.add(validateEntryIndex(entry.index));
  return [...values].sort((left, right) => right - left);
}

function stripPrintStringQuotes(value: string): string {
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
}
