import type { Oop } from "../oop.ts";
import type { GciErrorInfo, GciRuntime, LoginOptions, RuntimeName, SymDictLookup } from "../types.ts";

export class SerializedGciRuntime implements GciRuntime {
  readonly delegate: GciRuntime;
  #tail: Promise<void> = Promise.resolve();
  #sessionId: number | undefined;

  constructor(delegate: GciRuntime) {
    this.delegate = delegate;
  }

  get name(): RuntimeName {
    return this.delegate.name;
  }

  bindSessionId(sessionId: number): void {
    this.#sessionId = sessionId || undefined;
  }

  init(libPath?: string): Promise<number | void> {
    return this.#enqueue(() => this.delegate.init(libPath), { activate: false });
  }

  encrypt(password: string): Promise<string> {
    return this.#enqueue(() => this.delegate.encrypt(password), { activate: false });
  }

  setNet(stoneName: string, hostUsername: string, encryptedHostPassword: string, gemService: string): Promise<void> {
    return this.#enqueue(
      () => this.delegate.setNet(stoneName, hostUsername, encryptedHostPassword, gemService),
      { activate: false },
    );
  }

  loginEx(options: LoginOptions): Promise<number> {
    return this.#enqueue(() => this.delegate.loginEx(options), { activate: false });
  }

  logout(sessionId?: number): Promise<void> {
    return this.#enqueue(() => this.delegate.logout(sessionId));
  }

  commit(): Promise<boolean> {
    return this.#enqueue(() => this.delegate.commit());
  }

  abort(): Promise<boolean> {
    return this.#enqueue(() => this.delegate.abort());
  }

  err(): Promise<GciErrorInfo | null> {
    return this.#enqueue(() => this.delegate.err());
  }

  executeStr(source: string, receiver?: Oop): Promise<Oop> {
    return this.#enqueue(() => this.delegate.executeStr(source, receiver));
  }

  perform(receiver: Oop, selector: string, args?: Oop[]): Promise<Oop> {
    return this.#enqueue(() => this.delegate.perform(receiver, selector, args));
  }

  newString(value: string): Promise<Oop> {
    return this.#enqueue(() => this.delegate.newString(value));
  }

  newSymbol(value: string): Promise<Oop> {
    return this.#enqueue(() => this.delegate.newSymbol(value));
  }

  newOop(classOop: Oop): Promise<Oop> {
    return this.#enqueue(() => this.delegate.newOop(classOop));
  }

  resolveSymbol(name: string, symbolList?: Oop): Promise<Oop> {
    return this.#enqueue(() => this.delegate.resolveSymbol(name, symbolList));
  }

  fetchClass(oop: Oop): Promise<Oop> {
    return this.#enqueue(() => this.delegate.fetchClass(oop));
  }

  fetchSize(oop: Oop): Promise<number> {
    return this.#enqueue(() => this.delegate.fetchSize(oop));
  }

  fetchBytes(oop: Oop, start: number, count: number): Promise<Uint8Array> {
    return this.#enqueue(() => this.delegate.fetchBytes(oop, start, count));
  }

  getSessionId(): Promise<number> {
    return this.#enqueue(() => this.delegate.getSessionId(), { activate: false });
  }

  setSessionId(sessionId: number): Promise<void> {
    return this.#enqueue(async () => {
      await this.delegate.setSessionId(sessionId);
      this.bindSessionId(sessionId);
    }, { activate: false });
  }

  needsCommit(): Promise<boolean> {
    return this.#enqueue(() => this.delegate.needsCommit());
  }

  inTransaction(): Promise<boolean> {
    return this.#enqueue(() => this.delegate.inTransaction());
  }

  fltToOop(value: number): Promise<Oop> {
    return this.#enqueue(() => this.delegate.fltToOop(value));
  }

  oopToFlt(oop: Oop): Promise<number> {
    return this.#enqueue(() => this.delegate.oopToFlt(oop));
  }

  symDictAt(dict: Oop, key: string): Promise<SymDictLookup> {
    return this.#enqueue(() => this.delegate.symDictAt(dict, key));
  }

  symDictAtPut(dict: Oop, key: string, value: Oop): Promise<void> {
    return this.#enqueue(() => this.delegate.symDictAtPut(dict, key, value));
  }

  symDictAtObjPut(dict: Oop, key: Oop, value: Oop): Promise<void> {
    return this.#enqueue(() => this.delegate.symDictAtObjPut(dict, key, value));
  }

  strKeyValueDictAt(dict: Oop, key: string): Promise<Oop> {
    return this.#enqueue(() => this.delegate.strKeyValueDictAt(dict, key));
  }

  strKeyValueDictAtPut(dict: Oop, key: string, value: Oop): Promise<void> {
    return this.#enqueue(() => this.delegate.strKeyValueDictAtPut(dict, key, value));
  }

  addOopToExportSet(oop: Oop): Promise<void> {
    return this.#enqueue(() => this.delegate.addOopToExportSet(oop));
  }

  removeOopFromExportSet(oop: Oop): Promise<void> {
    return this.#enqueue(() => this.delegate.removeOopFromExportSet(oop));
  }

  #enqueue<T>(
    fn: () => Promise<T>,
    options: { activate?: boolean } = {},
  ): Promise<T> {
    const activate = options.activate ?? true;
    const run = async () => {
      if (activate && this.#sessionId !== undefined) {
        await this.delegate.setSessionId(this.#sessionId);
      }
      return fn();
    };
    const result = this.#tail.then(run, run);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function serializeGciRuntime(runtime: GciRuntime): SerializedGciRuntime {
  return runtime instanceof SerializedGciRuntime ? runtime : new SerializedGciRuntime(runtime);
}
