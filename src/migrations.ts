import { PersistentRoot } from "./persistent-root.ts";
import { OOP_NIL, type Oop } from "./oop.ts";
import type { GemStoneArgument, MarshalledValue, Session } from "./client.ts";

type MaybePromise<T> = T | Promise<T>;

export const DEFAULT_MIGRATION_ROOT = "GemstoneJsMigrations";
export const DEFAULT_MIGRATION_LOCK = `${DEFAULT_MIGRATION_ROOT}Lock`;
export const DEFAULT_MIGRATION_LOCK_STALE_AFTER_SECONDS = 60 * 60;

export type MigrationCallback = (session: Session) => MaybePromise<void>;
export type MigrationInput = MigrationStep;

export interface MigrationStep {
  id: string;
  upgrade: MigrationCallback;
  downgrade?: MigrationCallback;
  dependencies?: readonly string[];
  checksum?: string;
  description?: string;
}

export interface MigrationRecord {
  id: string;
  checksum: string;
  appliedAt: string;
  description: string;
}

export interface MigrationResult {
  direction: "upgrade" | "downgrade";
  target?: string | null;
  steps: string[];
  dryRun: boolean;
  operations: string[];
}

export interface MigrationStatus {
  current: string | null;
  applied: string[];
  pending: string[];
}

export interface MigrationLock {
  key: string;
  owner: string;
  acquiredAt: string;
  rootKey: string;
}

export interface MigrationRunOptions {
  target?: string | null;
  dryRun?: boolean;
  rootKey?: string;
  useLock?: boolean;
  lockKey?: string;
  lockOwner?: string;
  lockStaleAfterSeconds?: number | null;
  forceLock?: boolean;
  recordDryRun?: boolean;
}

export interface MigrationLockOptions {
  rootKey?: string;
  lockKey?: string;
  owner?: string;
  staleAfterSeconds?: number | null;
  force?: boolean;
}

export interface MigrationsCliIo {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  connect(): Promise<Session>;
  loadManifest(specifier: string): Promise<readonly MigrationInput[]>;
}

interface MigrationCliOptions {
  help: boolean;
  command: "current" | "status" | "plan" | "upgrade" | "downgrade" | "";
  manifest?: string;
  direction: "upgrade" | "downgrade";
  target?: string | null;
  dryRun: boolean;
  recordDryRun: boolean;
  rootKey: string;
  useLock: boolean;
  lockKey?: string;
  lockOwner?: string;
  lockStaleAfterSeconds: number | null;
  forceLock: boolean;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export class MigrationsCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationsCliUsageError";
  }
}

export class RecordingMigrationSession {
  readonly operations: string[] = [];

  async eval(source: string): Promise<MarshalledValue> {
    this.#record("eval", source);
    return null;
  }

  async execute(source: string): Promise<Oop> {
    this.#record("execute", source);
    return OOP_NIL;
  }

  async executeObject(source: string): Promise<Oop> {
    this.#record("executeObject", source);
    return OOP_NIL;
  }

  async performValueWith(receiver: Oop, selector: string, ...args: GemStoneArgument[]): Promise<MarshalledValue> {
    this.#record("performValueWith", receiver, selector, ...args);
    return null;
  }

  async performWith(receiver: Oop, selector: string, ...args: GemStoneArgument[]): Promise<Oop> {
    this.#record("performWith", receiver, selector, ...args);
    return OOP_NIL;
  }

  async newString(value: string): Promise<Oop> {
    this.#record("newString", value);
    return OOP_NIL;
  }

  async newSymbol(value: string): Promise<Oop> {
    this.#record("newSymbol", value);
    return OOP_NIL;
  }

  async resolveSymbol(name: string): Promise<Oop> {
    this.#record("resolveSymbol", name);
    return OOP_NIL;
  }

  async globalGet(name: string): Promise<MarshalledValue> {
    this.#record("globalGet", name);
    return null;
  }

  async globalGetValue(name: string): Promise<MarshalledValue> {
    this.#record("globalGetValue", name);
    return null;
  }

  async globalSet(name: string, value: GemStoneArgument): Promise<void> {
    this.#record("globalSet", name, value);
  }

  async globalRemove(name: string): Promise<boolean> {
    this.#record("globalRemove", name);
    return false;
  }

  async globalHas(name: string): Promise<boolean> {
    this.#record("globalHas", name);
    return false;
  }

  async commit(): Promise<void> {
    this.#record("commit");
  }

  async abort(): Promise<void> {
    this.#record("abort");
  }

  #record(method: string, ...args: unknown[]): void {
    this.operations.push(`session.${method}(${args.map(formatRecordedArgument).join(", ")})`);
  }
}

export function planUpgrade(
  steps: readonly MigrationInput[],
  applied: Iterable<string> | Record<string, unknown> = [],
  options: { target?: string | null } = {},
): MigrationStep[] {
  const ordered = orderedSteps(coerceSteps(steps));
  const known = new Set(ordered.map((step) => step.id));
  const target = options.target ?? null;
  if (target !== null && !known.has(target)) {
    throw new MigrationError(`unknown migration target ${JSON.stringify(target)}`);
  }

  const appliedIds = appliedIdSet(applied);
  const pending: MigrationStep[] = [];
  for (const step of ordered) {
    if (!appliedIds.has(step.id)) pending.push(step);
    if (step.id === target) break;
  }
  return pending;
}

export function planDowngrade(
  steps: readonly MigrationInput[],
  applied: Iterable<string> | Record<string, unknown>,
  options: { target?: string | null } = {},
): MigrationStep[] {
  const ordered = orderedSteps(coerceSteps(steps));
  const appliedIds = appliedIdSet(applied);
  let target = options.target ?? null;
  if (target === "base") target = null;
  const known = new Set(ordered.map((step) => step.id));
  if (target !== null) {
    if (!known.has(target)) throw new MigrationError(`unknown migration target ${JSON.stringify(target)}`);
    if (!appliedIds.has(target)) throw new MigrationError(`migration target ${JSON.stringify(target)} is not applied`);
  }

  const pending: MigrationStep[] = [];
  for (const step of [...ordered].reverse()) {
    if (!appliedIds.has(step.id)) continue;
    if (target !== null && step.id === target) break;
    pending.push(step);
  }
  return pending;
}

export function validateMigrationState(
  steps: readonly MigrationInput[],
  applied: Iterable<string> | Record<string, unknown>,
): MigrationStep[] {
  const ordered = orderedSteps(coerceSteps(steps));
  const byId = new Map(ordered.map((step) => [step.id, step]));
  const appliedIds = appliedIdSet(applied);
  const unknown = [...appliedIds].filter((id) => !byId.has(id)).sort();
  if (unknown.length) {
    throw new MigrationError(`GemStone has applied migration(s) not present in the local manifest: ${unknown.join(", ")}`);
  }
  if (!isRecord(applied)) return ordered;
  for (const [id, value] of Object.entries(applied)) {
    const record = normalizeMigrationRecord(id, value);
    const localChecksum = byId.get(id)?.checksum ?? "";
    if (record.checksum && localChecksum && record.checksum !== localChecksum) {
      throw new MigrationError(`checksum mismatch for applied migration ${id}: GemStone has ${record.checksum}, local file has ${localChecksum}`);
    }
  }
  return ordered;
}

export async function appliedMigrations(
  session: Session,
  options: { rootKey?: string } = {},
): Promise<Record<string, MigrationRecord>> {
  const rootKey = options.rootKey ?? DEFAULT_MIGRATION_ROOT;
  const value = await PersistentRoot.userGlobals(session).getValue(rootKey);
  return parseAppliedMigrations(value, rootKey);
}

export async function currentVersion(
  session: Session,
  options: { rootKey?: string } = {},
): Promise<string | null> {
  return currentVersionFromApplied(await appliedMigrations(session, options));
}

export async function migrationStatus(
  session: Session,
  steps: readonly MigrationInput[],
  options: { rootKey?: string } = {},
): Promise<MigrationStatus> {
  const applied = await appliedMigrations(session, options);
  const ordered = validateMigrationState(steps, applied);
  const pending = planUpgrade(ordered, applied);
  return {
    current: currentVersionFromApplied(applied),
    applied: Object.keys(applied),
    pending: pending.map((step) => step.id),
  };
}

export async function acquireMigrationLock(
  session: Session,
  options: MigrationLockOptions = {},
): Promise<MigrationLock> {
  const rootKey = options.rootKey ?? DEFAULT_MIGRATION_ROOT;
  const key = options.lockKey ?? DEFAULT_MIGRATION_LOCK;
  const owner = options.owner ?? defaultLockOwner();
  const staleAfterSeconds = options.staleAfterSeconds === undefined
    ? DEFAULT_MIGRATION_LOCK_STALE_AFTER_SECONDS
    : options.staleAfterSeconds;
  const root = PersistentRoot.userGlobals(session);
  const existing = parseMigrationLock(await root.getValue(key), key);
  if (existing && !options.force && !lockIsStale(existing, staleAfterSeconds)) {
    throw new MigrationError(`migration lock ${JSON.stringify(key)} is held by ${existing.owner || "unknown"}`);
  }

  const lock: MigrationLock = {
    key,
    owner,
    acquiredAt: new Date().toISOString(),
    rootKey,
  };
  await root.setValue(key, JSON.stringify(lock));
  try {
    await session.commit();
  } catch (error) {
    await session.abort().catch(() => undefined);
    throw new MigrationError(`failed to acquire migration lock ${JSON.stringify(key)}: ${errorMessage(error)}`);
  }
  return lock;
}

export async function releaseMigrationLock(
  session: Session,
  lock: MigrationLock,
  options: { force?: boolean } = {},
): Promise<void> {
  const root = PersistentRoot.userGlobals(session);
  const existing = parseMigrationLock(await root.getValue(lock.key), lock.key);
  if (!existing) return;
  if (!options.force && existing.owner !== lock.owner) {
    throw new MigrationError(`migration lock ${JSON.stringify(lock.key)} is held by ${existing.owner || "unknown"}; not releasing lock owned by ${JSON.stringify(lock.owner)}`);
  }
  await root.remove(lock.key);
  try {
    await session.commit();
  } catch (error) {
    await session.abort().catch(() => undefined);
    throw new MigrationError(`failed to release migration lock ${JSON.stringify(lock.key)}: ${errorMessage(error)}`);
  }
}

export async function upgrade(
  session: Session,
  steps: readonly MigrationInput[],
  options: MigrationRunOptions = {},
): Promise<MigrationResult> {
  const rootKey = options.rootKey ?? DEFAULT_MIGRATION_ROOT;
  const applied = await appliedMigrations(session, { rootKey });
  const ordered = validateMigrationState(steps, applied);
  const pending = planUpgrade(ordered, applied, { target: options.target });
  if (options.dryRun) {
    return {
      direction: "upgrade",
      target: options.target ?? null,
      steps: pending.map((step) => step.id),
      dryRun: true,
      operations: options.recordDryRun ? await recordPendingSteps(pending, "upgrade") : [],
    };
  }

  const lock = options.useLock === false || pending.length === 0 ? null : await acquireMigrationLock(session, {
    rootKey,
    lockKey: options.lockKey,
    owner: options.lockOwner,
    staleAfterSeconds: options.lockStaleAfterSeconds,
    force: options.forceLock,
  });
  let operationError: unknown;
  try {
    for (const step of pending) {
      try {
        await step.upgrade(session);
        applied[step.id] = appliedRecord(step);
        await writeAppliedMigrations(session, applied, { rootKey });
        await session.commit();
      } catch (error) {
        await session.abort().catch(() => undefined);
        throw new MigrationError(`failed to apply migration ${step.id}: ${errorMessage(error)}`);
      }
    }
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (lock) {
      try {
        await releaseMigrationLock(session, lock, { force: options.forceLock });
      } catch (error) {
        if (operationError === undefined) throw error;
      }
    }
  }
  return {
    direction: "upgrade",
    target: options.target ?? null,
    steps: pending.map((step) => step.id),
    dryRun: false,
    operations: [],
  };
}

export async function downgrade(
  session: Session,
  steps: readonly MigrationInput[],
  options: MigrationRunOptions = {},
): Promise<MigrationResult> {
  const rootKey = options.rootKey ?? DEFAULT_MIGRATION_ROOT;
  const applied = await appliedMigrations(session, { rootKey });
  const ordered = validateMigrationState(steps, applied);
  const pending = planDowngrade(ordered, applied, { target: options.target ?? "base" });
  const missing = pending.filter((step) => !step.downgrade).map((step) => step.id);
  if (missing.length) throw new MigrationError(`migration(s) do not support downgrade: ${missing.join(", ")}`);
  if (options.dryRun) {
    return {
      direction: "downgrade",
      target: options.target ?? "base",
      steps: pending.map((step) => step.id),
      dryRun: true,
      operations: options.recordDryRun ? await recordPendingSteps(pending, "downgrade") : [],
    };
  }

  const lock = options.useLock === false || pending.length === 0 ? null : await acquireMigrationLock(session, {
    rootKey,
    lockKey: options.lockKey,
    owner: options.lockOwner,
    staleAfterSeconds: options.lockStaleAfterSeconds,
    force: options.forceLock,
  });
  let operationError: unknown;
  try {
    for (const step of pending) {
      try {
        if (!step.downgrade) throw new MigrationError(`migration ${step.id} does not support downgrade`);
        await step.downgrade(session);
        delete applied[step.id];
        await writeAppliedMigrations(session, applied, { rootKey });
        await session.commit();
      } catch (error) {
        await session.abort().catch(() => undefined);
        throw new MigrationError(`failed to roll back migration ${step.id}: ${errorMessage(error)}`);
      }
    }
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (lock) {
      try {
        await releaseMigrationLock(session, lock, { force: options.forceLock });
      } catch (error) {
        if (operationError === undefined) throw error;
      }
    }
  }
  return {
    direction: "downgrade",
    target: options.target ?? "base",
    steps: pending.map((step) => step.id),
    dryRun: false,
    operations: [],
  };
}

export function migrationStepsFromManifest(module: unknown): MigrationStep[] {
  const manifest = isRecord(module) && isRecord(module.default) && (Array.isArray(module.default.migrations) || Array.isArray(module.default.MIGRATIONS))
    ? module.default
    : module;
  const entries = isRecord(manifest)
    ? (manifest.migrations ?? manifest.MIGRATIONS)
    : undefined;
  if (!Array.isArray(entries)) {
    throw new MigrationError("migration manifest must export migrations or MIGRATIONS array");
  }
  return coerceSteps(entries as readonly MigrationInput[]);
}

export function formatMigrationPlan(direction: "upgrade" | "downgrade", steps: readonly MigrationStep[]): string {
  const lines = [`${direction}: ${steps.length} step(s)`];
  for (const step of steps) {
    lines.push(`  ${step.id}${step.description ? ` - ${step.description}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatMigrationStatus(status: MigrationStatus): string {
  const lines = [
    `current: ${status.current ?? "base"}`,
    `applied: ${status.applied.length}`,
    ...status.applied.map((id) => `  ${id}`),
    `pending: ${status.pending.length}`,
    ...status.pending.map((id) => `  ${id}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatMigrationResult(result: MigrationResult): string {
  const label = result.dryRun ? `${result.direction} dry-run` : result.direction;
  const lines = [
    `${label}: ${result.steps.length} step(s)`,
    ...result.steps.map((id) => `  ${id}`),
  ];
  if (result.operations.length) {
    lines.push("recorded operations:");
    for (const operation of result.operations) lines.push(`  ${operation}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runMigrationsCli(argv: readonly string[], io: MigrationsCliIo): Promise<number> {
  let options: MigrationCliOptions;
  try {
    options = parseMigrationsCliArgs(argv);
  } catch (error) {
    io.stderr.write(`${errorMessage(error)}\n\n${migrationsCliUsage()}`);
    return 2;
  }

  if (options.help) {
    io.stdout.write(migrationsCliUsage());
    return 0;
  }

  let session: Session | undefined;
  try {
    if (options.command === "current") {
      session = await io.connect();
      io.stdout.write(`${await currentVersion(session, { rootKey: options.rootKey }) ?? "base"}\n`);
      await session.abort();
      return 0;
    }

    const steps = await io.loadManifest(requiredManifest(options));
    session = await io.connect();
    if (options.command === "status") {
      io.stdout.write(formatMigrationStatus(await migrationStatus(session, steps, { rootKey: options.rootKey })));
      await session.abort();
      return 0;
    }
    if (options.command === "plan") {
      const applied = await appliedMigrations(session, { rootKey: options.rootKey });
      const ordered = validateMigrationState(steps, applied);
      const pending = options.direction === "upgrade"
        ? planUpgrade(ordered, applied, { target: options.target })
        : planDowngrade(ordered, applied, { target: options.target });
      io.stdout.write(formatMigrationPlan(options.direction, pending));
      await session.abort();
      return 0;
    }
    if (options.command === "upgrade") {
      const result = await upgrade(session, steps, runOptions(options));
      io.stdout.write(formatMigrationResult(result));
      if (result.dryRun) await session.abort();
      return 0;
    }
    if (options.command === "downgrade") {
      const result = await downgrade(session, steps, runOptions(options));
      io.stdout.write(formatMigrationResult(result));
      if (result.dryRun) await session.abort();
      return 0;
    }
    throw new MigrationsCliUsageError("Missing command.");
  } catch (error) {
    if (session) await session.abort().catch(() => undefined);
    io.stderr.write(`gemstone-js-migrations: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    if (session) await session.logout().catch(() => undefined);
  }
}

export function migrationsCliUsage(): string {
  return [
    "Usage: gemstone-js-migrations <command> [options]",
    "",
    "Commands:",
    "  current",
    "  status --manifest <module>",
    "  plan --manifest <module> [--direction upgrade|downgrade] [--target <id|base>]",
    "  upgrade --manifest <module> [--target <id>] [--dry-run] [--record]",
    "  downgrade --manifest <module> [--target <id|base>] [--dry-run] [--record]",
    "",
    "Options:",
    "  --root-key <name>",
    "  --no-lock",
    "  --lock-key <name>",
    "  --lock-owner <text>",
    "  --lock-stale-after <seconds>",
    "  --force-lock",
    "",
  ].join("\n");
}

function parseMigrationsCliArgs(argv: readonly string[]): MigrationCliOptions {
  const options: MigrationCliOptions = {
    help: false,
    command: "",
    direction: "upgrade",
    dryRun: false,
    recordDryRun: false,
    rootKey: DEFAULT_MIGRATION_ROOT,
    useLock: true,
    lockStaleAfterSeconds: DEFAULT_MIGRATION_LOCK_STALE_AFTER_SECONDS,
    forceLock: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--manifest") options.manifest = requiredValue(argv, ++index, arg);
    else if (arg === "--direction") {
      const value = requiredValue(argv, ++index, arg);
      if (value !== "upgrade" && value !== "downgrade") throw new MigrationsCliUsageError("--direction must be upgrade or downgrade");
      options.direction = value;
    } else if (arg === "--target") options.target = requiredValue(argv, ++index, arg);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--record") options.recordDryRun = true;
    else if (arg === "--root-key") options.rootKey = requiredValue(argv, ++index, arg);
    else if (arg === "--no-lock") options.useLock = false;
    else if (arg === "--lock-key") options.lockKey = requiredValue(argv, ++index, arg);
    else if (arg === "--lock-owner") options.lockOwner = requiredValue(argv, ++index, arg);
    else if (arg === "--lock-stale-after") options.lockStaleAfterSeconds = parseNonNegativeNumber(requiredValue(argv, ++index, arg), arg);
    else if (arg === "--force-lock") options.forceLock = true;
    else if (arg.startsWith("-")) throw new MigrationsCliUsageError(`Unexpected argument: ${arg}`);
    else if (!options.command) {
      if (arg !== "current" && arg !== "status" && arg !== "plan" && arg !== "upgrade" && arg !== "downgrade") {
        throw new MigrationsCliUsageError(`Unknown command: ${arg}`);
      }
      options.command = arg;
    } else {
      throw new MigrationsCliUsageError(`Unexpected argument: ${arg}`);
    }
  }
  if (!options.command && !options.help) throw new MigrationsCliUsageError("Missing command.");
  if (options.command && options.command !== "current" && !options.manifest) {
    throw new MigrationsCliUsageError(`${options.command} requires --manifest`);
  }
  if (options.recordDryRun && !options.dryRun) throw new MigrationsCliUsageError("--record requires --dry-run");
  return options;
}

function runOptions(options: MigrationCliOptions): MigrationRunOptions {
  return {
    target: options.target,
    dryRun: options.dryRun,
    rootKey: options.rootKey,
    useLock: options.useLock,
    lockKey: options.lockKey,
    lockOwner: options.lockOwner,
    lockStaleAfterSeconds: options.lockStaleAfterSeconds,
    forceLock: options.forceLock,
    recordDryRun: options.recordDryRun,
  };
}

async function writeAppliedMigrations(
  session: Session,
  applied: Record<string, MigrationRecord>,
  options: { rootKey: string },
): Promise<void> {
  const root = PersistentRoot.userGlobals(session);
  if (Object.keys(applied).length === 0) {
    await root.remove(options.rootKey);
    return;
  }
  await root.setValue(options.rootKey, JSON.stringify(applied));
}

async function recordPendingSteps(steps: readonly MigrationStep[], direction: "upgrade" | "downgrade"): Promise<string[]> {
  const recorder = new RecordingMigrationSession();
  for (const step of steps) {
    recorder.operations.push(`# ${direction} ${step.id}`);
    const callback = direction === "upgrade" ? step.upgrade : step.downgrade;
    if (!callback) throw new MigrationError(`migration ${step.id} does not support ${direction}`);
    await callback(recorder as unknown as Session);
  }
  return recorder.operations;
}

function coerceSteps(steps: readonly MigrationInput[]): MigrationStep[] {
  return steps.map((step) => {
    if (!isRecord(step) || typeof step.id !== "string" || typeof step.upgrade !== "function") {
      throw new MigrationError("migration steps must include id and upgrade(session)");
    }
    const dependencies = step.dependencies;
    if (dependencies !== undefined && (!Array.isArray(dependencies) || dependencies.some((value) => typeof value !== "string"))) {
      throw new MigrationError(`migration ${step.id} dependencies must be strings`);
    }
    if (step.downgrade !== undefined && typeof step.downgrade !== "function") {
      throw new MigrationError(`migration ${step.id} downgrade must be a function`);
    }
    return {
      id: step.id,
      upgrade: step.upgrade as MigrationCallback,
      downgrade: step.downgrade as MigrationCallback | undefined,
      dependencies: dependencies as readonly string[] | undefined,
      checksum: typeof step.checksum === "string" ? step.checksum : "",
      description: typeof step.description === "string" ? step.description : "",
    };
  });
}

function orderedSteps(steps: readonly MigrationStep[]): MigrationStep[] {
  const byId = new Map<string, MigrationStep>();
  for (const step of steps) {
    if (byId.has(step.id)) throw new MigrationError(`duplicate migration id ${JSON.stringify(step.id)}`);
    byId.set(step.id, step);
  }
  const ordered: MigrationStep[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (step: MigrationStep): void => {
    if (visited.has(step.id)) return;
    if (visiting.has(step.id)) throw new MigrationError(`migration dependency cycle at ${JSON.stringify(step.id)}`);
    visiting.add(step.id);
    for (const dependency of step.dependencies ?? []) {
      const dependencyStep = byId.get(dependency);
      if (!dependencyStep) throw new MigrationError(`migration ${JSON.stringify(step.id)} depends on unknown migration ${JSON.stringify(dependency)}`);
      visit(dependencyStep);
    }
    visiting.delete(step.id);
    visited.add(step.id);
    ordered.push(step);
  };
  for (const step of steps) visit(step);
  return ordered;
}

function appliedIdSet(applied: Iterable<string> | Record<string, unknown>): Set<string> {
  if (isRecord(applied)) return new Set(Object.keys(applied));
  return new Set([...applied].map(String));
}

function parseAppliedMigrations(value: MarshalledValue, rootKey: string): Record<string, MigrationRecord> {
  if (value === null) return {};
  if (typeof value !== "string") {
    throw new MigrationError(`${rootKey} must be a JSON string migration table, got ${typeof value}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new MigrationError(`${rootKey} contains invalid JSON: ${errorMessage(error)}`);
  }
  if (!isRecord(parsed)) throw new MigrationError(`${rootKey} must contain a JSON object`);
  const result: Record<string, MigrationRecord> = {};
  for (const [id, record] of Object.entries(parsed)) {
    result[id] = normalizeMigrationRecord(id, record);
  }
  return result;
}

function normalizeMigrationRecord(id: string, value: unknown): MigrationRecord {
  if (!isRecord(value)) {
    return { id, checksum: String(value ?? ""), appliedAt: "", description: "" };
  }
  return {
    id: typeof value.id === "string" && value.id ? value.id : id,
    checksum: typeof value.checksum === "string" ? value.checksum : "",
    appliedAt: typeof value.appliedAt === "string" ? value.appliedAt : typeof value.applied_at === "string" ? value.applied_at : "",
    description: typeof value.description === "string" ? value.description : "",
  };
}

function parseMigrationLock(value: MarshalledValue, key: string): MigrationLock | null {
  if (value === null) return null;
  if (typeof value !== "string") return { key, owner: String(value), acquiredAt: "", rootKey: DEFAULT_MIGRATION_ROOT };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { key, owner: value, acquiredAt: "", rootKey: DEFAULT_MIGRATION_ROOT };
  }
  if (!isRecord(parsed)) return { key, owner: value, acquiredAt: "", rootKey: DEFAULT_MIGRATION_ROOT };
  return {
    key: typeof parsed.key === "string" ? parsed.key : key,
    owner: typeof parsed.owner === "string" ? parsed.owner : "",
    acquiredAt: typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : typeof parsed.acquired_at === "string" ? parsed.acquired_at : "",
    rootKey: typeof parsed.rootKey === "string" ? parsed.rootKey : DEFAULT_MIGRATION_ROOT,
  };
}

function lockIsStale(lock: MigrationLock, staleAfterSeconds: number | null): boolean {
  if (staleAfterSeconds === null) return false;
  const acquiredMs = Date.parse(lock.acquiredAt);
  if (!Number.isFinite(acquiredMs)) return false;
  return Date.now() - acquiredMs > staleAfterSeconds * 1000;
}

function appliedRecord(step: MigrationStep): MigrationRecord {
  return {
    id: step.id,
    checksum: step.checksum ?? "",
    appliedAt: new Date().toISOString(),
    description: step.description ?? "",
  };
}

function currentVersionFromApplied(applied: Record<string, MigrationRecord>): string | null {
  const records = Object.values(applied);
  if (records.length === 0) return null;
  records.sort((left, right) => {
    const byTime = left.appliedAt.localeCompare(right.appliedAt);
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime;
  });
  return records[records.length - 1].id;
}

function defaultLockOwner(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
  return `gemstone-js:${random}`;
}

function requiredManifest(options: MigrationCliOptions): string {
  if (!options.manifest) throw new MigrationsCliUsageError(`${options.command} requires --manifest`);
  return options.manifest;
}

function requiredValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("-")) throw new MigrationsCliUsageError(`${flag} requires a value`);
  return value;
}

function parseNonNegativeNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new MigrationsCliUsageError(`${flag} must be a non-negative number`);
  return parsed;
}

function formatRecordedArgument(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
