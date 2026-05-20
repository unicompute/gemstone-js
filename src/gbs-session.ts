import { PersistentRoot } from "./persistent-root.ts";
import {
  commitWithConflictDetails,
  runTransactionWithRetry,
} from "./transactions.ts";
import {
  Session,
  type GemStoneArgument,
  type GemStoneDictionaryArgument,
  type MarshalledValue,
} from "./client.ts";
import { type GsDict } from "./gsdict.ts";
import type { GciRuntime, SessionConfig } from "./types.ts";

type MaybePromise<T> = T | Promise<T>;

export interface GbsSessionParametersOptions extends SessionConfig {
  name?: string;
  gemStoneName?: string;
  netldiHostOrIp?: string;
  netldiNameOrPort?: string;
}

export class GbsSessionParameters {
  #name: string | undefined;
  #config: SessionConfig;

  constructor(options: GbsSessionParametersOptions = {}) {
    const {
      name,
      gemStoneName,
      netldiHostOrIp,
      netldiNameOrPort,
      ...config
    } = options;
    this.#name = name;
    this.#config = { ...Session.configFromEnv(), ...config };
    if (gemStoneName !== undefined) this.#config.stone = gemStoneName;
    if (netldiHostOrIp !== undefined) this.#config.host = netldiHostOrIp;
    if (netldiNameOrPort !== undefined) this.#config.netldi = netldiNameOrPort;
  }

  name(value: string): this {
    this.#name = value;
    return this;
  }

  gemStoneName(value: string): this {
    this.#config.stone = value;
    return this;
  }

  username(value: string): this {
    this.#config.username = value;
    return this;
  }

  password(value: string): this {
    this.#config.password = value;
    return this;
  }

  netldiHostOrIp(value: string): this {
    this.#config.host = value;
    return this;
  }

  netldiNameOrPort(value: string): this {
    this.#config.netldi = value;
    return this;
  }

  runtime(value: GciRuntime): this {
    this.#config.runtime = value;
    return this;
  }

  configure(config: SessionConfig): this {
    this.#config = { ...this.#config, ...config };
    return this;
  }

  async login(): Promise<GbsSession> {
    return new GbsSession(await Session.connect(this.#config), { name: this.#name });
  }
}

export interface GbsSessionOptions {
  name?: string;
}

export class GbsSession implements AsyncDisposable {
  readonly session: Session;
  readonly name?: string;
  readonly userGlobals: GbsSymbolDictionary;
  readonly bridgeRoot: GbsSymbolDictionary;

  constructor(session: Session, options: GbsSessionOptions = {}) {
    this.session = session;
    this.name = options.name;
    this.userGlobals = new GbsSymbolDictionary(PersistentRoot.userGlobals(session));
    this.bridgeRoot = this.userGlobals;
  }

  commit(): Promise<void> {
    return this.session.commit();
  }

  commitTransaction(): Promise<void> {
    return this.session.commit();
  }

  commitTransactionOrSignalConflict(): Promise<void> {
    return commitWithConflictDetails(this.session);
  }

  commitTransactionWithRetryCount(attempts: number): Promise<void>;
  commitTransactionWithRetryCount<T>(
    attempts: number,
    work: (session: GbsSession) => MaybePromise<T>,
  ): Promise<T>;
  async commitTransactionWithRetryCount<T>(
    attempts: number,
    work?: (session: GbsSession) => MaybePromise<T>,
  ): Promise<T | void> {
    if (!work) {
      await commitWithConflictDetails(this.session);
      return;
    }
    return runTransactionWithRetry(
      () => work(this),
      { session: this.session, attempts, commit: commitWithConflictDetails },
    );
  }

  abortTransaction(): Promise<void> {
    return this.session.abort();
  }

  disconnect(): Promise<void> {
    return this.session.logout();
  }

  logout(): Promise<void> {
    return this.disconnect();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.disconnect();
  }
}

export class GbsSymbolDictionary {
  readonly root: PersistentRoot;

  constructor(root: PersistentRoot) {
    this.root = root;
  }

  get rootName(): string {
    return this.root.rootName;
  }

  at(name: string): Promise<MarshalledValue> {
    return this.root.getValue(name);
  }

  async atPut(name: string, value: GemStoneArgument): Promise<this> {
    await this.root.setValue(name, value);
    return this;
  }

  atDict(name: string): Promise<GsDict | null> {
    return this.root.getDict(name);
  }

  async atPutDict(name: string, value: GemStoneDictionaryArgument): Promise<GsDict> {
    return this.root.setDict(name, value);
  }

  includesKey(name: string): Promise<boolean> {
    return this.root.has(name);
  }

  removeKey(name: string): Promise<boolean> {
    return this.root.remove(name);
  }
}

export function gbsSessionParameters(options: GbsSessionParametersOptions = {}): GbsSessionParameters {
  return new GbsSessionParameters(options);
}

export async function gbsSession(
  options: GbsSessionParametersOptions = {},
): Promise<GbsSession> {
  return new GbsSessionParameters(options).login();
}
