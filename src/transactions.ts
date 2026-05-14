import { oopToHex, type Oop } from "./oop.ts";
import { Session } from "./client.ts";
import { GemStoneError, type SessionConfig } from "./types.ts";

type MaybePromise<T> = T | Promise<T>;

export interface ConflictObject {
  oop: Oop;
  kind: "write/write" | "write/dependency";
  className?: string;
  summary?: string;
  inspectionError?: string;
}

export interface ConflictDiagnostics {
  report: string;
  writeWrite: ConflictObject[];
  writeDependency: ConflictObject[];
}

export class CommitConflictError extends Error {
  readonly report: string;
  readonly writeWriteConflicts: Oop[];
  readonly writeDependencyConflicts: Oop[];

  constructor(report: string, writeWriteConflicts: readonly Oop[] = [], writeDependencyConflicts: readonly Oop[] = []) {
    super(report || "Commit conflict");
    this.name = "CommitConflictError";
    this.report = report || "Commit conflict";
    this.writeWriteConflicts = [...writeWriteConflicts];
    this.writeDependencyConflicts = [...writeDependencyConflicts];
  }

  async diagnostics(session?: Session, options: { includeSummaries?: boolean } = {}): Promise<ConflictDiagnostics> {
    return describeCommitConflict(this, session, options);
  }

  async format(session?: Session, options: { includeSummaries?: boolean } = {}): Promise<string> {
    return formatCommitConflict(this, session, options);
  }

  async toObject(session?: Session, options: { includeSummaries?: boolean } = {}): Promise<{
    report: string;
    writeWrite: ConflictObject[];
    writeDependency: ConflictObject[];
  }> {
    return this.diagnostics(session, options);
  }
}

export class TransactionRetry {
  readonly attempt: number;
  readonly attempts: number;
  readonly conflict: CommitConflictError;

  constructor(options: { attempt: number; attempts: number; conflict: CommitConflictError }) {
    this.attempt = options.attempt;
    this.attempts = options.attempts;
    this.conflict = options.conflict;
  }

  get remaining(): number {
    return Math.max(this.attempts - this.attempt, 0);
  }

  get willRetry(): boolean {
    return this.attempt < this.attempts;
  }

  get exhausted(): boolean {
    return !this.willRetry;
  }

  async diagnostics(session?: Session, options: { includeSummaries?: boolean } = {}): Promise<ConflictDiagnostics> {
    return this.conflict.diagnostics(session, options);
  }

  async format(session?: Session, options: { includeSummaries?: boolean } = {}): Promise<string> {
    const state = this.willRetry ? "will retry" : "no attempts remaining";
    const details = await this.conflict.format(session, options);
    return [
      `Commit conflict on attempt ${this.attempt}/${this.attempts} (${state})`,
      ...details.split("\n").map((line) => `  ${line}`),
    ].join("\n");
  }

  async toObject(session?: Session, options: { includeSummaries?: boolean } = {}): Promise<{
    attempt: number;
    attempts: number;
    remaining: number;
    willRetry: boolean;
    exhausted: boolean;
    conflict: ConflictDiagnostics;
  }> {
    return {
      attempt: this.attempt,
      attempts: this.attempts,
      remaining: this.remaining,
      willRetry: this.willRetry,
      exhausted: this.exhausted,
      conflict: await this.diagnostics(session, options),
    };
  }
}

export interface TransactionRetryOptions {
  attempts?: number;
  session?: Session;
  config?: SessionConfig;
  sessionFactory?: (config?: SessionConfig) => MaybePromise<Session>;
  onConflict?: (retry: TransactionRetry) => MaybePromise<void>;
  commit?: (session: Session) => MaybePromise<void>;
}

export type TransactionWork<T> = (session: Session) => MaybePromise<T>;

export async function runTransactionWithRetry<T>(
  work: TransactionWork<T>,
  options: TransactionRetryOptions = {},
): Promise<T> {
  const attempts = validateAttempts(options.attempts ?? 3);
  if (options.session && (options.config || options.sessionFactory)) {
    throw new TypeError("Pass either an existing session or session creation options, not both.");
  }
  const commit = options.commit ?? commitWithConflictDetails;
  if (options.session) {
    return runOnExistingSession(work, {
      session: options.session,
      attempts,
      onConflict: options.onConflict,
      commit,
    });
  }
  return runOnOwnedSessions(work, {
    attempts,
    config: options.config,
    sessionFactory: options.sessionFactory ?? ((config) => Session.connect(config)),
    onConflict: options.onConflict,
    commit,
  });
}

export function retryingTransaction<T>(work: TransactionWork<T>, options: TransactionRetryOptions = {}): Promise<T> {
  return runTransactionWithRetry(work, options);
}

export async function commitWithConflictDetails(session: Session): Promise<void> {
  try {
    await session.commit();
  } catch (error) {
    if (!isCommitConflictLike(error)) throw error;
    const report = await readConflictReport(session);
    const [writeWrite, writeDependency] = await Promise.all([
      collectConflictOops(session, "currentTransactionWWConflicts"),
      collectConflictOops(session, "currentTransactionWDConflicts"),
    ]);
    throw new CommitConflictError(report, writeWrite, writeDependency);
  }
}

export async function describeCommitConflict(
  conflict: CommitConflictError,
  session?: Session,
  options: { includeSummaries?: boolean } = {},
): Promise<ConflictDiagnostics> {
  const includeSummaries = options.includeSummaries ?? true;
  return {
    report: conflict.report,
    writeWrite: await describeConflictObjects(conflict.writeWriteConflicts, "write/write", session, includeSummaries),
    writeDependency: await describeConflictObjects(conflict.writeDependencyConflicts, "write/dependency", session, includeSummaries),
  };
}

export async function formatCommitConflict(
  conflict: CommitConflictError,
  session?: Session,
  options: { includeSummaries?: boolean } = {},
): Promise<string> {
  return formatConflictDiagnostics(await describeCommitConflict(conflict, session, options));
}

export function formatConflictDiagnostics(diagnostics: ConflictDiagnostics): string {
  const lines = ["Commit conflict"];
  appendConflictGroup(lines, "Write/write conflicts", diagnostics.writeWrite);
  appendConflictGroup(lines, "Write/dependency conflicts", diagnostics.writeDependency);
  const report = diagnostics.report.trim();
  if (report) {
    lines.push("GemStone report:");
    lines.push(...report.split(/\r?\n/).map((line) => `  ${line}`));
  }
  return lines.join("\n");
}

async function runOnExistingSession<T>(
  work: TransactionWork<T>,
  options: {
    session: Session;
    attempts: number;
    onConflict?: (retry: TransactionRetry) => MaybePromise<void>;
    commit: (session: Session) => MaybePromise<void>;
  },
): Promise<T> {
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const result = await work(options.session);
      await options.commit(options.session);
      return result;
    } catch (error) {
      if (error instanceof CommitConflictError) {
        await notifyConflict(options.onConflict, attempt, options.attempts, error);
        await abortIgnoringErrors(options.session);
        if (attempt === options.attempts) throw error;
        continue;
      }
      await abortIgnoringErrors(options.session);
      throw error;
    }
  }
  throw new Error("Unreachable transaction retry state.");
}

async function runOnOwnedSessions<T>(
  work: TransactionWork<T>,
  options: {
    attempts: number;
    config?: SessionConfig;
    sessionFactory: (config?: SessionConfig) => MaybePromise<Session>;
    onConflict?: (retry: TransactionRetry) => MaybePromise<void>;
    commit: (session: Session) => MaybePromise<void>;
  },
): Promise<T> {
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const session = await options.sessionFactory(options.config);
    try {
      const result = await work(session);
      await options.commit(session);
      return result;
    } catch (error) {
      if (error instanceof CommitConflictError) {
        await notifyConflict(options.onConflict, attempt, options.attempts, error);
        await abortIgnoringErrors(session);
        if (attempt === options.attempts) throw error;
      } else {
        await abortIgnoringErrors(session);
        throw error;
      }
    } finally {
      await session.logout().catch(() => undefined);
    }
  }
  throw new Error("Unreachable transaction retry state.");
}

async function notifyConflict(
  listener: ((retry: TransactionRetry) => MaybePromise<void>) | undefined,
  attempt: number,
  attempts: number,
  conflict: CommitConflictError,
): Promise<void> {
  if (listener) await listener(new TransactionRetry({ attempt, attempts, conflict }));
}

async function abortIgnoringErrors(session: Session): Promise<void> {
  await session.abort().catch(() => undefined);
}

function validateAttempts(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("transaction retry attempts must be a positive safe integer.");
  }
  return value;
}

function isCommitConflictLike(error: unknown): boolean {
  if (error instanceof CommitConflictError) return true;
  if (!(error instanceof GemStoneError)) return false;
  return error.number === 0 && /commit failed|conflict/i.test(error.message);
}

async function readConflictReport(session: Session): Promise<string> {
  try {
    const report = await session.eval("System conflictReportString");
    return typeof report === "string" && report.trim() ? report : "Commit conflict";
  } catch {
    return "Commit conflict";
  }
}

async function collectConflictOops(session: Session, selector: string): Promise<Oop[]> {
  try {
    const collection = await session.execute(`System ${selector}`);
    return await session.arrayOopToOops(collection);
  } catch {
    return [];
  }
}

async function describeConflictObjects(
  oops: readonly Oop[],
  kind: ConflictObject["kind"],
  session: Session | undefined,
  includeSummaries: boolean,
): Promise<ConflictObject[]> {
  const result: ConflictObject[] = [];
  for (const conflictOop of oops) {
    result.push(await describeConflictObject(conflictOop, kind, session, includeSummaries));
  }
  return result;
}

async function describeConflictObject(
  conflictOop: Oop,
  kind: ConflictObject["kind"],
  session: Session | undefined,
  includeSummaries: boolean,
): Promise<ConflictObject> {
  if (!session) return { oop: conflictOop, kind };
  try {
    const inspection = await session.inspect(conflictOop);
    return {
      oop: conflictOop,
      kind,
      className: inspection.class,
      summary: includeSummaries ? inspection.printString : undefined,
    };
  } catch (error) {
    return {
      oop: conflictOop,
      kind,
      inspectionError: error instanceof Error ? error.message : String(error),
    };
  }
}

function appendConflictGroup(lines: string[], title: string, objects: readonly ConflictObject[]): void {
  if (!objects.length) return;
  lines.push(`${title}:`);
  for (const object of objects) {
    let line = `  - ${oopToHex(object.oop)} (${object.oop.toString()})`;
    if (object.className) line += ` ${object.className}`;
    if (object.summary) line += `: ${object.summary}`;
    if (object.inspectionError) line += ` [inspect failed: ${object.inspectionError}]`;
    lines.push(line);
  }
}
