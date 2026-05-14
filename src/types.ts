import type { Oop } from "./oop.ts";
import type { MetricsCollector, Tracer } from "./observability.ts";

export type RuntimeName = "node" | "deno" | "bun" | "mock";

export interface GciErrorInfo {
  number: number;
  fatal: boolean;
  message: string;
  reason?: string;
  category?: Oop;
  context?: Oop;
  exceptionObj?: Oop;
  args?: Oop[];
}

export class GemStoneError extends Error {
  readonly number: number;
  readonly fatal: boolean;
  readonly info?: GciErrorInfo;

  constructor(message: string, info?: Partial<GciErrorInfo>) {
    super(message);
    this.name = "GemStoneError";
    this.number = info?.number ?? 0;
    this.fatal = info?.fatal ?? false;
    this.info = info as GciErrorInfo | undefined;
  }

  static fromInfo(info: GciErrorInfo): GemStoneError {
    const reason = info.reason && info.reason !== info.message ? ` [${info.reason}]` : "";
    return new GemStoneError(info.message ? `${info.message}${reason}` : `GemStone error #${info.number}`, info);
  }
}

export class GemStoneConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GemStoneConfigurationError";
  }
}

export interface SessionConfig {
  stone?: string;
  netldi?: string;
  host?: string;
  username?: string;
  password?: string;
  hostUsername?: string;
  hostPassword?: string;
  gemService?: string;
  libPath?: string;
  runtime?: GciRuntime;
  tracer?: Tracer;
  metrics?: MetricsCollector;
  slowQueryThresholdMs?: number;
}

export interface ResolvedSessionConfig {
  stone: string;
  netldi: string;
  host: string;
  username: string;
  password: string;
  hostUsername: string;
  hostPassword: string;
  gemService: string;
  libPath?: string;
  tracer?: Tracer;
  metrics?: MetricsCollector;
  slowQueryThresholdMs?: number;
}

export interface LoginOptions {
  stone: string;
  netldi: string;
  host: string;
  username: string;
  password: string;
  hostUsername: string;
  hostPassword: string;
  gemService: string;
  libPath?: string;
  flags?: number;
  haltOnError?: boolean;
}

export interface SymDictLookup {
  value: Oop;
  assoc: Oop;
}

export interface GemStoneSlotInspection {
  name: string;
  value: string;
  oop?: Oop;
  oopString?: string;
  class?: string;
}

export interface GemStoneIndexedFieldInspection {
  index: number;
  value: string;
  oop?: Oop;
  oopString?: string;
  class?: string;
}

export interface GemStoneInspection {
  oop: Oop;
  class: string;
  classOop?: Oop;
  printString: string;
  size?: number;
  byteSize?: number;
  classHierarchy?: string[];
  slots?: GemStoneSlotInspection[];
  indexedFields?: GemStoneIndexedFieldInspection[];
}

export interface GemStoneClassDescription {
  name: string;
  oop?: Oop;
  superclasses: string[];
  instVarNames: string[];
  classInstVarNames: string[];
  instanceCount?: number;
}

export interface GemStoneDumpOptions {
  depth?: number;
  includeIndexedFields?: boolean;
}

export interface GemStoneObjectReference {
  oop?: Oop;
  oopString?: string;
  class?: string;
  printString: string;
}

export type GemStoneDumpValue = GemStoneObjectDump | GemStoneObjectReference;

export interface GemStoneObjectDump {
  oop: Oop;
  oopString: string;
  class?: string;
  printString?: string;
  cycle?: boolean;
  slots?: Record<string, GemStoneDumpValue>;
  indexedFields?: Array<{ index: number; value: GemStoneDumpValue }>;
}

export interface GciRuntime {
  readonly name: RuntimeName;
  init(libPath?: string): Promise<number | void>;
  encrypt(password: string): Promise<string>;
  setNet(stoneName: string, hostUsername: string, encryptedHostPassword: string, gemService: string): Promise<void>;
  loginEx(options: LoginOptions): Promise<number>;
  logout(sessionId?: number): Promise<void>;
  commit(): Promise<boolean>;
  abort(): Promise<boolean>;
  err(): Promise<GciErrorInfo | null>;
  executeStr(source: string, receiver?: Oop): Promise<Oop>;
  perform(receiver: Oop, selector: string, args?: Oop[]): Promise<Oop>;
  newString(value: string): Promise<Oop>;
  newSymbol(value: string): Promise<Oop>;
  newOop(classOop: Oop): Promise<Oop>;
  resolveSymbol(name: string, symbolList?: Oop): Promise<Oop>;
  fetchClass(oop: Oop): Promise<Oop>;
  fetchSize(oop: Oop): Promise<number>;
  fetchBytes(oop: Oop, start: number, count: number): Promise<Uint8Array>;
  getSessionId(): Promise<number>;
  setSessionId(sessionId: number): Promise<void>;
  needsCommit(): Promise<boolean>;
  inTransaction(): Promise<boolean>;
  fltToOop(value: number): Promise<Oop>;
  oopToFlt(oop: Oop): Promise<number>;
  symDictAt(dict: Oop, key: string): Promise<SymDictLookup>;
  symDictAtPut(dict: Oop, key: string, value: Oop): Promise<void>;
  symDictAtObjPut(dict: Oop, key: Oop, value: Oop): Promise<void>;
  strKeyValueDictAt(dict: Oop, key: string): Promise<Oop>;
  strKeyValueDictAtPut(dict: Oop, key: string, value: Oop): Promise<void>;
  addOopToExportSet(oop: Oop): Promise<void>;
  removeOopFromExportSet(oop: Oop): Promise<void>;
}

export interface PoolStats {
  inUse: number;
  idle: number;
  pendingAcquires: number;
  currentCapacity: number;
  createdTotal: number;
  evictedTotal: number;
  validationFailures: number;
  recycleAgeDiscards: number;
  recycleUseDiscards: number;
  idleTimeoutDiscards: number;
  acquireWaitsTotal: number;
  acquireWaitMsTotal: number;
}
