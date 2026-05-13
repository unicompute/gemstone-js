import type { GemStoneArgument, MarshalledValue, Session, TypedOop } from "./client.ts";
import type { Oop } from "./oop.ts";
import type { GemStoneInspection } from "./types.ts";

export class GsDict implements AsyncDisposable {
  readonly session: Session;
  readonly oop: Oop;

  constructor(session: Session, oop: Oop) {
    this.session = session;
    this.oop = oop;
  }

  static async create(
    session: Session,
    initial: Record<string, GemStoneArgument> = {},
  ): Promise<GsDict> {
    return new GsDict(session, await session.dictionaryToOop(initial));
  }

  async get(key: string): Promise<MarshalledValue> {
    return this.session.strDictGet(this.oop, key);
  }

  async getOop(key: string): Promise<Oop | null> {
    return this.session.strDictGetOop(this.oop, key);
  }

  async getObject<T = unknown>(key: string): Promise<TypedOop<T> | null> {
    const value = await this.getOop(key);
    return value === null ? null : this.session.typedOop<T>(value);
  }

  async set(key: string, value: GemStoneArgument): Promise<this> {
    await this.session.strDictSet(this.oop, key, value);
    return this;
  }

  async setOop(key: string, value: Oop): Promise<this> {
    await this.session.runtime.strKeyValueDictAtPut(this.oop, key, value);
    return this;
  }

  async has(key: string): Promise<boolean> {
    return await this.getOop(key) !== null;
  }

  async keys(): Promise<string[]> {
    const source = `
      | dict |
      dict := Object _objectForOop: ${this.oop.toString()}.
      String streamContents: [:stream |
        dict keysAndValuesDo: [:key :value |
          stream nextPutAll: key asString; lf]]
    `;
    const result = await this.session.eval(source);
    return typeof result === "string" ? result.split(/\r?\n/).filter(Boolean) : [];
  }

  async pick(keys: readonly string[]): Promise<Record<string, MarshalledValue>> {
    const result: Record<string, MarshalledValue> = {};
    for (const key of keys) {
      result[key] = await this.get(key);
    }
    return result;
  }

  async entries(): Promise<Record<string, MarshalledValue>> {
    return this.pick(await this.keys());
  }

  async requireOop(key: string): Promise<Oop> {
    const value = await this.getOop(key);
    if (value === null) throw this.#missingEntry(key);
    return value;
  }

  async requireValue(key: string): Promise<MarshalledValue> {
    return this.session.marshalOop(await this.requireOop(key));
  }

  async requireObject<T = unknown>(key: string): Promise<TypedOop<T>> {
    return this.session.typedOop<T>(await this.requireOop(key));
  }

  async send<R = MarshalledValue>(selector: string, ...args: GemStoneArgument[]): Promise<R> {
    return await this.session.performValueWith(this.oop, selector, ...args) as R;
  }

  async sendValue<R = MarshalledValue>(selector: string, ...args: GemStoneArgument[]): Promise<R> {
    return this.send<R>(selector, ...args);
  }

  async sendOop(selector: string, ...args: GemStoneArgument[]): Promise<Oop> {
    return this.session.performWith(this.oop, selector, ...args);
  }

  async sendObject<R = unknown>(selector: string, ...args: GemStoneArgument[]): Promise<TypedOop<R>> {
    return this.session.typedOop<R>(await this.sendOop(selector, ...args));
  }

  async inspect(): Promise<GemStoneInspection> {
    return this.session.inspect(this.oop);
  }

  async printString(): Promise<string> {
    return (await this.inspect()).printString;
  }

  async [Symbol.asyncDispose](): Promise<void> {}

  #missingEntry(key: string): Error {
    return new Error(`GemStone dictionary has no entry for key ${key}.`);
  }
}
