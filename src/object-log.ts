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

  async entries(): Promise<ObjectLogEntry[]> {
    const raw = await this.session.eval(objectLogEntriesSource());
    return parseObjectLogEntries(raw === null ? "" : String(raw));
  }

  async traces(): Promise<ObjectLogEntry[]> {
    return this.entriesFor("trace");
  }

  async debugs(): Promise<ObjectLogEntry[]> {
    return this.entriesFor("debug");
  }

  async infos(): Promise<ObjectLogEntry[]> {
    return this.entriesFor("info");
  }

  async warns(): Promise<ObjectLogEntry[]> {
    return this.entriesFor("warn");
  }

  async errors(): Promise<ObjectLogEntry[]> {
    return this.entriesFor("error");
  }

  async fatals(): Promise<ObjectLogEntry[]> {
    return this.entriesFor("fatal");
  }

  async entriesFor(level: ObjectLogLevelName | ObjectLogPriority): Promise<ObjectLogEntry[]> {
    const priority = normalizePriority(level);
    return (await this.entries()).filter((entry) => entry.priority === priority);
  }

  async size(): Promise<number> {
    const value = await this.session.eval("ObjectLogEntry objectLog size printString");
    const parsed = Number(String(value).trim());
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  async clear(): Promise<void> {
    await this.session.execute("ObjectLogEntry objectLog removeAllSuchThat: [:entry | true].");
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
      index: rowIndex,
      tagged,
      tag,
    });
  }
  return entries;
}

function objectLogEntriesSource(): string {
  return `
    | encode stream log |
    ${escapedFieldEncoderSource("encode")}
    log := ObjectLogEntry objectLog.
    stream := ''.
    0 to: log size - 1 do: [:index |
      | entry objectPrint tagString hasTag |
      entry := log at: index + 1.
      objectPrint := [entry object printString] on: Error do: ['nil'].
      hasTag := [entry hasTag] on: Error do: [false].
      tagString := (hasTag and: [entry tag notNil])
        ifTrue: [[entry tag printString] on: Error do: ['']]
        ifFalse: [''].
      stream := stream,
        (encode value: entry priority printString), '|',
        (encode value: (entry label isNil ifTrue: [''] ifFalse: [entry label])), '|',
        (encode value: objectPrint), '|',
        (encode value: entry pid printString), '|',
        (encode value: entry stamp printString), '|',
        (hasTag ifTrue: ['1'] ifFalse: ['0']), '|',
        (encode value: tagString), '\\q'
    ].
    stream
  `;
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

function validateEntryIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("ObjectLog entry index must be a non-negative safe integer.");
  }
  return value;
}

function stripPrintStringQuotes(value: string): string {
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
}
