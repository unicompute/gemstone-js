import { createGciRuntime } from "./runtime/index.ts";
import { serializeGciRuntime } from "./runtime/serialized.ts";
import { GsDict } from "./gsdict.ts";
import {
  OOP_FALSE,
  OOP_ILLEGAL,
  OOP_NIL,
  OOP_TRUE,
  boolToOop,
  isChar,
  isIllegal,
  isNil,
  isSmallint,
  marshalImmediateOop,
  oop,
  oopToChar,
  oopToHex,
  oopToSmallint,
  smallintToOop,
  type Oop,
} from "./oop.ts";
import { NULL_METRICS, NULL_TRACER, observe, type MetricsCollector, type Tracer } from "./observability.ts";
import {
  GemStoneConfigurationError,
  GemStoneError,
  type GemStoneInspection,
  type GciRuntime,
  type ResolvedSessionConfig,
  type SessionConfig,
} from "./types.ts";

export type MarshalledValue = bigint | number | boolean | string | null | Oop;
export type GemStoneDictionaryArgument = { readonly [key: string]: GemStoneArgument };
export type GemStoneArgument = ManagedOop<unknown> | string | number | bigint | boolean | null | GemStoneDictionaryArgument;

export class Session implements AsyncDisposable {
  readonly config: ResolvedSessionConfig;
  readonly runtime: GciRuntime;
  #sessionId: number;
  #loggedIn = true;
  #managedOopCounts = new Map<Oop, number>();
  #stringClassOopKeys: Promise<Set<string>> | undefined;

  private constructor(runtime: GciRuntime, config: ResolvedSessionConfig, sessionId: number) {
    this.runtime = runtime;
    this.config = config;
    this.#sessionId = sessionId;
  }

  static async connect(config: SessionConfig = {}): Promise<Session> {
    const runtime = serializeGciRuntime(config.runtime ?? await createGciRuntime());
    const resolved = resolveSessionConfig(config);
    await runtime.init(resolved.libPath);

    const stoneName = stoneNrs(resolved);
    const encryptedHostPassword = await runtime.encrypt(resolved.hostPassword);
    await runtime.setNet(stoneName, resolved.hostUsername, encryptedHostPassword, resolved.gemService);

    const loginResult = await runtime.loginEx({
      stone: resolved.stone,
      netldi: resolved.netldi,
      host: resolved.host,
      username: resolved.username,
      password: resolved.password,
      hostUsername: resolved.hostUsername,
      hostPassword: resolved.hostPassword,
      gemService: resolved.gemService,
      libPath: resolved.libPath,
      flags: 0,
      haltOnError: false,
    });
    if (!loginResult) {
      const info = await runtime.err();
      throw info ? GemStoneError.fromInfo(info) : new GemStoneError("GemStone login failed.");
    }

    const sessionId = await runtime.getSessionId().catch(() => loginResult);
    runtime.bindSessionId(sessionId);
    return new Session(runtime, resolved, sessionId);
  }

  static configFromEnv(overrides: SessionConfig = {}): SessionConfig {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    return {
      stone: env.GS_STONE ?? env.GS_STONE_NAME ?? "gs64stone",
      netldi: env.GS_NETLDI ?? "netldi",
      host: env.GS_HOST ?? "localhost",
      username: env.GS_USERNAME,
      password: env.GS_PASSWORD,
      hostUsername: env.GS_HOST_USERNAME ?? "",
      hostPassword: env.GS_HOST_PASSWORD ?? "",
      gemService: env.GS_GEM_SERVICE ?? "gemnetobject",
      libPath: env.GS_LIB_PATH,
      ...overrides,
    };
  }

  get sessionId(): number {
    return this.#sessionId;
  }

  get loggedIn(): boolean {
    return this.#loggedIn;
  }

  async execute(source: string): Promise<Oop> {
    return this.#observe("execute", { source_length: source.length }, async () => {
      const result = await this.runtime.executeStr(source, OOP_NIL);
      await this.#checkResult(result);
      return result;
    });
  }

  async eval(source: string): Promise<MarshalledValue> {
    const result = await this.execute(source);
    return this.marshalOop(result);
  }

  async perform(receiver: Oop, selector: string, ...args: Oop[]): Promise<Oop> {
    return this.#observe("perform", { selector, argc: args.length }, async () => {
      const result = await this.runtime.perform(receiver, selector, args);
      await this.#checkResult(result);
      return result;
    });
  }

  async performValue(receiver: Oop, selector: string, ...args: Oop[]): Promise<MarshalledValue> {
    const result = await this.perform(receiver, selector, ...args);
    return this.marshalOop(result);
  }

  async performWith(receiver: Oop, selector: string, ...args: GemStoneArgument[]): Promise<Oop> {
    return this.perform(receiver, selector, ...await this.argumentsToOops(args));
  }

  async performValueWith(receiver: Oop, selector: string, ...args: GemStoneArgument[]): Promise<MarshalledValue> {
    const result = await this.performWith(receiver, selector, ...args);
    return this.marshalOop(result);
  }

  async argumentToOop(value: GemStoneArgument): Promise<Oop> {
    if (value instanceof ManagedOop) return value.oop;
    if (value === null) return OOP_NIL;
    if (typeof value === "boolean") return boolToOop(value);
    if (typeof value === "number") {
      return Number.isSafeInteger(value) ? smallintToOop(value) : this.floatOop(value);
    }
    if (typeof value === "string") return this.newString(value);
    if (typeof value === "bigint") return smallintToOop(value);
    if (isPlainRecord(value)) return this.dictionaryToOop(value);
    throw new TypeError(`Cannot convert ${typeof value} to GemStone OOP.`);
  }

  async argumentsToOops(args: readonly GemStoneArgument[]): Promise<Oop[]> {
    const oops: Oop[] = [];
    for (const arg of args) {
      oops.push(await this.argumentToOop(arg));
    }
    return oops;
  }

  async newString(value: string): Promise<Oop> {
    return this.#observe("new_string", { value_length: value.length }, () => this.runtime.newString(value));
  }

  async newSymbol(value: string): Promise<Oop> {
    return this.#observe("new_symbol", { value_length: value.length }, () => this.runtime.newSymbol(value));
  }

  async smallintOop(value: number | bigint): Promise<Oop> {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new RangeError("SmallInteger number values must be safe integers.");
    }
    return smallintToOop(value);
  }

  async floatOop(value: number): Promise<Oop> {
    if (!Number.isFinite(value)) {
      throw new RangeError("GemStone Float arguments must be finite numbers.");
    }
    return this.#observe("float_oop", undefined, async () => {
      const result = await this.runtime.fltToOop(value);
      await this.#checkResult(result);
      return result;
    });
  }

  async newOop(classOop: Oop): Promise<Oop> {
    return this.#observe("new_oop", undefined, async () => {
      const result = await this.runtime.newOop(classOop);
      await this.#checkResult(result);
      return result;
    });
  }

  async resolveSymbol(name: string, symbolList: Oop = OOP_NIL): Promise<Oop> {
    return this.#observe("resolve_symbol", { name }, () => this.runtime.resolveSymbol(name, symbolList));
  }

  async fetchClass(value: Oop): Promise<Oop> {
    return this.#observe("fetch_class", undefined, async () => {
      const result = await this.runtime.fetchClass(value);
      await this.#checkResult(result);
      return result;
    });
  }

  async fetchSize(value: Oop): Promise<number> {
    return this.#observe("fetch_size", undefined, () => this.runtime.fetchSize(value));
  }

  async fetchBytes(value: Oop, start: number, count: number): Promise<Uint8Array> {
    const validatedStart = validateFetchStart(start);
    const validatedCount = validateFetchCount(count);
    return this.#observe("fetch_bytes", { start: validatedStart, count: validatedCount }, () => (
      this.runtime.fetchBytes(value, validatedStart, validatedCount)
    ));
  }

  async dictionaryToOop(value: GemStoneDictionaryArgument): Promise<Oop> {
    const entries = Object.entries(value);
    return this.#observe("dictionary_to_oop", { entries: entries.length }, async () => {
      const dictClass = await this.resolveSymbol("StringKeyValueDictionary");
      const dict = await this.newOop(dictClass);
      for (const [key, item] of entries) {
        await this.strDictSet(dict, key, item);
      }
      return dict;
    });
  }

  async dictionary(value: GemStoneDictionaryArgument = {}): Promise<GsDict> {
    return new GsDict(this, await this.dictionaryToOop(value));
  }

  dict(oop: Oop): GsDict {
    return new GsDict(this, oop);
  }

  async strDictGet(dict: Oop, key: string): Promise<MarshalledValue> {
    const value = await this.strDictGetOop(dict, key);
    if (value === null) return null;
    return this.marshalOop(value);
  }

  async strDictGetOop(dict: Oop, key: string): Promise<Oop | null> {
    return this.#observe("str_dict_get", { key }, async () => {
      const value = await this.runtime.strKeyValueDictAt(dict, key);
      if (isIllegal(value) || value === OOP_NIL) return null;
      return value;
    });
  }

  async strDictSet(dict: Oop, key: string, value: GemStoneArgument): Promise<void> {
    await this.#observe("str_dict_set", { key }, async () => {
      await this.runtime.strKeyValueDictAtPut(dict, key, await this.argumentToOop(value));
    });
  }

  async globalGet(name: string): Promise<MarshalledValue> {
    const value = await this.globalGetOop(name);
    if (value === null) return null;
    return this.marshalOop(value);
  }

  async globalGetOop(name: string): Promise<Oop | null> {
    return this.#observe("global_get", { name }, async () => {
      const userGlobals = await this.resolveSymbol("UserGlobals");
      const result = await this.runtime.symDictAt(userGlobals, name);
      if (isIllegal(result.value) || result.value === OOP_NIL) return null;
      return result.value;
    });
  }

  async globalSet(name: string, value: GemStoneArgument): Promise<void> {
    await this.#observe("global_set", { name }, async () => {
      const userGlobals = await this.resolveSymbol("UserGlobals");
      const key = await this.newSymbol(name);
      await this.runtime.symDictAtObjPut(userGlobals, key, await this.argumentToOop(value));
    });
  }

  async fetchString(value: Oop): Promise<string> {
    return this.#observe("fetch_string", undefined, async () => {
      const size = await this.fetchSize(value);
      if (size <= 0) return "";
      const bytes = await this.fetchBytes(value, 1, size);
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    });
  }

  async isStringOop(value: Oop): Promise<boolean> {
    try {
      const cls = await this.fetchClass(value);
      const stringClassKeys = await this.#stringClassKeys();
      return stringClassKeys.has(cls.toString());
    } catch {
      return false;
    }
  }

  async tryOopToFloat(value: Oop): Promise<number | undefined> {
    try {
      return await this.runtime.oopToFlt(value);
    } catch {
      return undefined;
    }
  }

  async marshalOop(value: Oop): Promise<MarshalledValue> {
    if (isNil(value)) return null;
    if (value === OOP_TRUE) return true;
    if (value === OOP_FALSE) return false;
    if (isIllegal(value)) throw new GemStoneError("OOP_ILLEGAL");
    if (isSmallint(value)) return oopToSmallint(value);
    if (isChar(value)) return oopToChar(value);

    const floatValue = await this.tryOopToFloat(value);
    if (floatValue !== undefined) return floatValue;

    if (await this.isStringOop(value)) {
      return this.fetchString(value);
    }

    return marshalImmediateOop(value);
  }

  async commit(): Promise<void> {
    await this.#observe("commit", undefined, async () => {
      if (!await this.runtime.commit()) {
        const info = await this.runtime.err();
        throw info ? GemStoneError.fromInfo(info) : new GemStoneError("GemStone commit failed.");
      }
    });
  }

  async abort(): Promise<void> {
    await this.#observe("abort", undefined, async () => {
      if (await this.runtime.abort()) return;
      const info = await this.runtime.err();
      if (info?.number) throw GemStoneError.fromInfo(info);
      const fallback = await this.runtime.executeStr("System abortTransaction", OOP_NIL);
      await this.#checkResult(fallback);
    });
  }

  async needsCommit(): Promise<boolean> {
    return this.#observe("needs_commit", undefined, () => this.runtime.needsCommit());
  }

  async inTransaction(): Promise<boolean> {
    return this.#observe("in_transaction", undefined, () => this.runtime.inTransaction());
  }

  async withTransaction<T>(fn: (session: Session) => Promise<T>): Promise<T> {
    try {
      const result = await fn(this);
      await this.commit();
      return result;
    } catch (error) {
      try {
        await this.abort();
      } catch {
        // Preserve the original application error.
      }
      throw error;
    }
  }

  async inspect(value: Oop): Promise<GemStoneInspection> {
    const source = `
      | obj |
      obj := Object _objectForOop: ${value.toString()}.
      String streamContents: [:stream |
        stream nextPutAll: (obj asOop asString); lf.
        stream nextPutAll: (obj class name asString); lf.
        stream nextPutAll: obj printString]
    `;
    return this.#observe("inspect", { oop: value.toString() }, async () => {
      const result = await this.runtime.executeStr(source, OOP_NIL);
      await this.#checkResult(result);
      const rendered = await this.marshalOop(result);
      if (typeof rendered !== "string") {
        throw new GemStoneError("GemStone inspect helper returned a non-string result.");
      }
      return parseInspectionPayload(rendered);
    });
  }

  async booleanOop(value: boolean): Promise<Oop> {
    return value ? OOP_TRUE : OOP_FALSE;
  }

  managedOop<T = unknown>(value: Oop): ManagedOop<T> {
    return new ManagedOop<T>(this, value);
  }

  typedOop<T = unknown>(value: Oop): TypedOop<T> {
    return new TypedOop<T>(this, value);
  }

  async logout(): Promise<void> {
    if (!this.#loggedIn) return;
    await this.#observe("logout", undefined, async () => {
      try {
        await this.runtime.logout(this.#sessionId);
      } finally {
        this.#loggedIn = false;
        this.#sessionId = 0;
        this.#managedOopCounts.clear();
      }
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.logout();
  }

  async retainManagedOop(value: Oop): Promise<void> {
    const count = this.#managedOopCounts.get(value) ?? 0;
    this.#managedOopCounts.set(value, count + 1);
    if (count === 0) await this.runtime.addOopToExportSet(value);
  }

  async releaseManagedOop(value: Oop): Promise<void> {
    const count = this.#managedOopCounts.get(value) ?? 0;
    if (count <= 1) {
      this.#managedOopCounts.delete(value);
      await this.runtime.removeOopFromExportSet(value);
      return;
    }
    this.#managedOopCounts.set(value, count - 1);
  }

  async #checkResult(result: Oop): Promise<void> {
    if (!isIllegal(result)) return;
    const info = await this.runtime.err();
    throw info ? GemStoneError.fromInfo(info) : new GemStoneError(`GemStone returned illegal OOP ${oopToHex(result)}.`);
  }

  async #stringClassKeys(): Promise<Set<string>> {
    this.#stringClassOopKeys ??= this.#resolveStringClassKeys();
    return this.#stringClassOopKeys;
  }

  async #resolveStringClassKeys(): Promise<Set<string>> {
    const result = new Set<string>();
    for (const name of ["String", "Symbol"]) {
      try {
        const value = await this.runtime.resolveSymbol(name, OOP_NIL);
        if (!isIllegal(value) && value !== OOP_NIL) {
          result.add(value.toString());
        }
      } catch {
        // Leave class absent; marshalOop will fall back to returning the OOP.
      }
    }
    return result;
  }

  async #observe<T>(
    operation: string,
    attrs: Record<string, string | number | boolean | null | undefined> | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    return observe(
      operation,
      { stone: this.config.stone, host: this.config.host, session_id: this.#sessionId, ...(attrs ?? {}) },
      this.config.tracer ?? NULL_TRACER,
      this.config.metrics ?? NULL_METRICS,
      this.config.slowQueryThresholdMs,
      fn,
    );
  }
}

export class ManagedOop<T = unknown> implements AsyncDisposable {
  readonly session: Session;
  readonly oop: Oop;
  readonly __classWitness?: T;
  #ready: Promise<void>;
  #released = false;

  constructor(session: Session, value: Oop) {
    this.session = session;
    this.oop = value;
    this.#ready = this.session.retainManagedOop(value);
    managedOopFinalizer.register(this, { session, value }, this);
  }

  async send<R = MarshalledValue>(selector: string, ...args: GemStoneArgument[]): Promise<R> {
    await this.#ready;
    return await this.session.performValueWith(this.oop, selector, ...args) as R;
  }

  async sendOop(selector: string, ...args: GemStoneArgument[]): Promise<Oop> {
    await this.#ready;
    return this.session.performWith(this.oop, selector, ...args);
  }

  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    managedOopFinalizer.unregister(this);
    await this.#ready;
    await this.session.releaseManagedOop(this.oop);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.release();
  }
}

export class TypedOop<T = unknown> extends ManagedOop<T> {
}

const managedOopFinalizer = new FinalizationRegistry<{ session: Session; value: Oop }>(
  ({ session, value }) => {
    void session.releaseManagedOop(value);
  },
);

export function resolveSessionConfig(config: SessionConfig = {}): ResolvedSessionConfig {
  const fromEnv = Session.configFromEnv(config);
  const username = fromEnv.username;
  const password = fromEnv.password;
  const missing: string[] = [];
  if (!username) missing.push("username/GS_USERNAME");
  if (!password) missing.push("password/GS_PASSWORD");
  if (missing.length) {
    throw new GemStoneConfigurationError(`GemStone credentials are required: missing ${missing.join(" and ")}.`);
  }
  return {
    stone: fromEnv.stone ?? "gs64stone",
    netldi: fromEnv.netldi ?? "netldi",
    host: fromEnv.host ?? "localhost",
    username: username as string,
    password: password as string,
    hostUsername: fromEnv.hostUsername ?? "",
    hostPassword: fromEnv.hostPassword ?? "",
    gemService: fromEnv.gemService ?? "gemnetobject",
    libPath: fromEnv.libPath,
    tracer: fromEnv.tracer,
    metrics: fromEnv.metrics,
    slowQueryThresholdMs: fromEnv.slowQueryThresholdMs,
  };
}

function stoneNrs(config: ResolvedSessionConfig): string {
  if (config.host && config.host !== "localhost" && config.host !== "127.0.0.1") {
    return `!@${config.host}!${config.netldi}!${config.stone}`;
  }
  return config.stone;
}

function isPlainRecord(value: unknown): value is GemStoneDictionaryArgument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateFetchStart(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("fetchBytes start must be a positive safe integer.");
  }
  return value;
}

function validateFetchCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("fetchBytes count must be a non-negative safe integer.");
  }
  return value;
}

function parseInspectionPayload(payload: string): GemStoneInspection {
  const normalized = payload.replace(/\r\n/g, "\n");
  const firstBreak = normalized.indexOf("\n");
  const secondBreak = firstBreak === -1 ? -1 : normalized.indexOf("\n", firstBreak + 1);
  if (firstBreak === -1 || secondBreak === -1) {
    throw new GemStoneError("GemStone inspect helper returned an invalid payload.");
  }
  const oopText = normalized.slice(0, firstBreak).trim();
  let inspectedOop: Oop;
  try {
    inspectedOop = oop(oopText);
  } catch {
    throw new GemStoneError(`GemStone inspect helper returned an invalid OOP: ${oopText}`);
  }
  return {
    oop: inspectedOop,
    class: normalized.slice(firstBreak + 1, secondBreak),
    printString: normalized.slice(secondBreak + 1),
  };
}
