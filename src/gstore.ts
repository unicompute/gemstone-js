import { GsDict, type KeyedReadbackOptions } from "./gsdict.ts";
import { PersistentRoot } from "./persistent-root.ts";
import type { Session } from "./client.ts";

export const GSTORE_ROOT = "GStoreRoot";

export type GStoreJsonValue =
  | string
  | number
  | boolean
  | null
  | GStoreJsonValue[]
  | { readonly [key: string]: GStoreJsonValue };

export interface GStoreTransactionOptions {
  readOnly?: boolean;
  maxReadEntries?: number;
  maxRetries?: number;
}

export type GStoreReadOptions = KeyedReadbackOptions;

type MaybePromise<T> = T | Promise<T>;

export class GStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GStoreError";
  }
}

export class GStoreAbortTransaction extends Error {
  constructor(message = "GStore transaction aborted.") {
    super(message);
    this.name = "GStoreAbortTransaction";
  }
}

export class GStoreTransaction {
  readonly readOnly: boolean;
  #open = true;
  #data: Map<string, GStoreJsonValue>;
  #dirty = new Map<string, GStoreJsonValue>();
  #deletes = new Set<string>();

  constructor(snapshot: Record<string, GStoreJsonValue>, readOnly: boolean) {
    this.readOnly = readOnly;
    this.#data = new Map(Object.entries(snapshot));
  }

  get dirty(): boolean {
    return this.#dirty.size > 0 || this.#deletes.size > 0;
  }

  get(key: string): GStoreJsonValue | undefined;
  get<T extends GStoreJsonValue>(key: string, defaultValue: T): GStoreJsonValue | T;
  get<T extends GStoreJsonValue>(key: string, defaultValue?: T): GStoreJsonValue | T | undefined {
    this.#requireOpen();
    const name = String(key);
    if (this.#dirty.has(name)) return this.#dirty.get(name);
    if (this.#deletes.has(name)) return defaultValue;
    return this.#data.has(name) ? this.#data.get(name) : defaultValue;
  }

  require(key: string): GStoreJsonValue {
    const value = this.get(key);
    if (value === undefined) throw new GStoreError(`GStore has no entry for key ${key}.`);
    return value;
  }

  set(key: string, value: GStoreJsonValue): this {
    this.#requireWritable();
    const name = String(key);
    assertJsonSerializable(value);
    this.#dirty.set(name, value);
    this.#deletes.delete(name);
    return this;
  }

  setAll(values: Record<string, GStoreJsonValue>): this {
    for (const [key, value] of Object.entries(values)) this.set(key, value);
    return this;
  }

  delete(key: string): boolean {
    this.#requireWritable();
    const name = String(key);
    const existed = this.has(name);
    this.#dirty.delete(name);
    this.#deletes.add(name);
    return existed;
  }

  remove(key: string): boolean {
    return this.delete(key);
  }

  has(key: string): boolean {
    this.#requireOpen();
    const name = String(key);
    if (this.#deletes.has(name)) return false;
    return this.#dirty.has(name) || this.#data.has(name);
  }

  keys(): string[] {
    this.#requireOpen();
    return [...new Set([...this.#data.keys(), ...this.#dirty.keys()])]
      .filter((key) => !this.#deletes.has(key));
  }

  values(): GStoreJsonValue[] {
    return this.keys().map((key) => this.require(key));
  }

  entries(): Array<[string, GStoreJsonValue]> {
    return this.keys().map((key) => [key, this.require(key)]);
  }

  toObject(): Record<string, GStoreJsonValue> {
    return Object.fromEntries(this.entries());
  }

  close(): void {
    this.#open = false;
  }

  dirtyEntries(): Record<string, GStoreJsonValue> {
    return Object.fromEntries(this.#dirty);
  }

  deletedKeys(): string[] {
    return [...this.#deletes];
  }

  #requireWritable(): void {
    this.#requireOpen();
    if (this.readOnly) throw new GStoreError("GStore transaction is read-only.");
  }

  #requireOpen(): void {
    if (!this.#open) throw new GStoreError("GStore transaction is not open.");
  }
}

export class GStore {
  readonly session: Session;
  readonly name: string;
  #inTransaction = false;

  constructor(session: Session, name = "") {
    this.session = session;
    this.name = name;
  }

  static async open(session: Session, name = ""): Promise<GStore> {
    const store = new GStore(session, name);
    await store.ensure();
    return store;
  }

  static async list(session: Session, options: KeyedReadbackOptions = {}): Promise<string[]> {
    const root = await findGStoreRoot(session);
    return root ? root.keys(options) : [];
  }

  static async has(session: Session, name: string): Promise<boolean> {
    const root = await findGStoreRoot(session);
    return root ? root.has(name) : false;
  }

  static async exists(session: Session, name: string): Promise<boolean> {
    return this.has(session, name);
  }

  static async remove(session: Session, name: string): Promise<boolean> {
    const root = await findGStoreRoot(session);
    return root ? root.remove(name) : false;
  }

  static async rm(session: Session, name: string): Promise<boolean> {
    return this.remove(session, name);
  }

  static async removeAll(session: Session): Promise<boolean> {
    return PersistentRoot.userGlobals(session).remove(GSTORE_ROOT);
  }

  static async rmAll(session: Session): Promise<boolean> {
    return this.removeAll(session);
  }

  async ensure(): Promise<this> {
    await this.#file();
    return this;
  }

  async exists(): Promise<boolean> {
    return GStore.has(this.session, this.name);
  }

  async has(): Promise<boolean> {
    return this.exists();
  }

  async read(options: GStoreReadOptions = {}): Promise<Record<string, GStoreJsonValue>> {
    return readFile(await this.#file(), options);
  }

  async transaction<T>(
    fn: (transaction: GStoreTransaction) => MaybePromise<T>,
    options: GStoreTransactionOptions = {},
  ): Promise<T | undefined> {
    if (this.#inTransaction) throw new GStoreError(`GStore '${this.name}': nested transaction not allowed.`);
    this.#inTransaction = true;
    const readOnly = options.readOnly ?? false;
    const maxRetries = normalizeMaxRetries(options.maxRetries ?? 10);
    let transaction: GStoreTransaction | undefined;
    try {
      await abortGStoreSession(this.session);
      transaction = new GStoreTransaction(await this.read({ maxEntries: options.maxReadEntries }), readOnly);
      let result: T;
      try {
        result = await fn(transaction);
      } catch (error) {
        transaction.close();
        await abortGStoreSession(this.session);
        if (error instanceof GStoreAbortTransaction) return undefined;
        throw error;
      }
      transaction.close();
      if (readOnly || !transaction.dirty) {
        await abortGStoreSession(this.session);
        return result;
      }
      await this.#commitWithRetry(transaction.dirtyEntries(), transaction.deletedKeys(), maxRetries);
      return result;
    } finally {
      transaction?.close();
      this.#inTransaction = false;
    }
  }

  async #commitWithRetry(
    dirty: Record<string, GStoreJsonValue>,
    deletes: readonly string[],
    maxRetries: number,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      await writeFile(await this.#file(), dirty, deletes);
      try {
        await this.session.commit();
        return;
      } catch (error) {
        if (!isLikelyCommitConflict(error)) {
          await this.session.abort().catch(() => undefined);
          throw error;
        }
        await this.session.abort();
        if (attempt >= maxRetries) {
          throw new GStoreError(`GStore: unable to commit '${this.name}' after ${maxRetries} attempts.`);
        }
      }
    }
  }

  async #file(): Promise<GsDict> {
    const root = await ensureGStoreRoot(this.session);
    let file = await root.getDict(this.name);
    if (!file) file = await root.setDict(this.name, {});
    return file;
  }
}

async function ensureGStoreRoot(session: Session): Promise<GsDict> {
  const userGlobals = PersistentRoot.userGlobals(session);
  let root = await userGlobals.getDict(GSTORE_ROOT);
  if (!root) root = await userGlobals.setDict(GSTORE_ROOT, {});
  return root;
}

async function findGStoreRoot(session: Session): Promise<GsDict | null> {
  return PersistentRoot.userGlobals(session).getDict(GSTORE_ROOT);
}

async function readFile(file: GsDict, options: GStoreReadOptions = {}): Promise<Record<string, GStoreJsonValue>> {
  const result: Record<string, GStoreJsonValue> = {};
  for (const [key, raw] of await file.items(options)) {
    result[key] = deserializeGStoreValue(raw);
  }
  return result;
}

async function writeFile(
  file: GsDict,
  dirty: Record<string, GStoreJsonValue>,
  deletes: readonly string[],
): Promise<void> {
  const serialized: Record<string, string> = {};
  for (const [key, value] of Object.entries(dirty)) serialized[key] = serializeGStoreValue(value);
  if (Object.keys(serialized).length) await file.setAllValue(serialized);
  if (deletes.length) await file.removeAll(deletes);
}

function serializeGStoreValue(value: GStoreJsonValue): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("GStore values must be JSON-serializable.");
  }
  return serialized;
}

function deserializeGStoreValue(value: unknown): GStoreJsonValue {
  if (typeof value !== "string") return coerceJsonValue(value);
  try {
    return coerceJsonValue(JSON.parse(value));
  } catch {
    return value;
  }
}

function coerceJsonValue(value: unknown): GStoreJsonValue {
  assertJsonSerializable(value);
  return value as GStoreJsonValue;
}

function assertJsonSerializable(value: unknown): void {
  if (!isJsonSerializable(value)) {
    throw new TypeError("GStore values must be JSON-serializable.");
  }
}

function isJsonSerializable(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonSerializable);
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Object.values(value as Record<string, unknown>).every(isJsonSerializable);
  }
  return false;
}

function normalizeMaxRetries(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("GStore maxRetries must be a positive safe integer.");
  }
  return value;
}

function isLikelyCommitConflict(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String((error as { reason?: unknown }).reason ?? "")}` : String(error);
  return /conflict/i.test(text);
}

async function abortGStoreSession(session: Session): Promise<void> {
  try {
    await session.abort();
  } catch (error) {
    if (isIgnorableGStoreAbortError(error)) return;
    throw error;
  }
}

function isIgnorableGStoreAbortError(error: unknown): boolean {
  const number = (error as { number?: unknown }).number;
  const text = error instanceof Error ? error.message : String(error);
  return number === 2021 && /rtErrKeyNotFound|non-existent key/i.test(text);
}
