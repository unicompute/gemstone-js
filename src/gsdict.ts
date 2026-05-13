import type {
  GemStoneArgument,
  GemStoneDictionaryArgument,
  MarshalledValue,
  Session,
  TypedOop,
} from "./client.ts";
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

  async getValue(key: string): Promise<MarshalledValue> {
    return this.get(key);
  }

  async getOop(key: string): Promise<Oop | null> {
    return this.session.strDictGetOop(this.oop, key);
  }

  async getObject<T = unknown>(key: string): Promise<TypedOop<T> | null> {
    const value = await this.getOop(key);
    return value === null ? null : this.session.typedOop<T>(value);
  }

  async getDict(key: string): Promise<GsDict | null> {
    const value = await this.getOop(key);
    return value === null ? null : new GsDict(this.session, value);
  }

  async set(key: string, value: GemStoneArgument): Promise<this> {
    await this.session.strDictSet(this.oop, key, value);
    return this;
  }

  async setValue(key: string, value: GemStoneArgument): Promise<this> {
    return this.set(key, value);
  }

  async setAll(values: Record<string, GemStoneArgument>): Promise<this> {
    for (const [key, value] of Object.entries(values)) {
      await this.session.strDictSet(this.oop, key, value);
    }
    return this;
  }

  async setAllValue(values: Record<string, GemStoneArgument>): Promise<this> {
    return this.setAll(values);
  }

  async setDict(key: string, value: GemStoneDictionaryArgument): Promise<GsDict> {
    const dict = await this.session.dictionary(value);
    await this.setOop(key, dict.oop);
    return dict;
  }

  async setAllDict(values: Record<string, GemStoneDictionaryArgument>): Promise<Record<string, GsDict>> {
    const result: Record<string, GsDict> = {};
    for (const [key, value] of Object.entries(values)) {
      result[key] = await this.setDict(key, value);
    }
    return result;
  }

  async setOop(key: string, value: Oop): Promise<this> {
    await this.session.runtime.strKeyValueDictAtPut(this.oop, key, value);
    return this;
  }

  async setAllOop(values: Record<string, Oop>): Promise<this> {
    for (const [key, value] of Object.entries(values)) {
      await this.session.runtime.strKeyValueDictAtPut(this.oop, key, value);
    }
    return this;
  }

  async remove(key: string): Promise<boolean> {
    const keyOop = await this.session.newString(key);
    const exists = await this.session.performValue(this.oop, "includesKey:", keyOop);
    if (!toBoolean(exists, "StringKeyValueDictionary includesKey:")) return false;
    await this.session.perform(this.oop, "removeKey:", keyOop);
    return true;
  }

  async delete(key: string): Promise<boolean> {
    return this.remove(key);
  }

  async removeAll(keys: readonly string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const key of keys) {
      result[key] = await this.remove(key);
    }
    return result;
  }

  async deleteAll(keys: readonly string[]): Promise<Record<string, boolean>> {
    return this.removeAll(keys);
  }

  async has(key: string): Promise<boolean> {
    return await this.getOop(key) !== null;
  }

  async hasAll(keys: readonly string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const key of keys) {
      result[key] = await this.has(key);
    }
    return result;
  }

  async size(): Promise<number> {
    return toSafeSize(await this.sendValue("size"));
  }

  async isEmpty(): Promise<boolean> {
    return await this.size() === 0;
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

  async pickOop(keys: readonly string[]): Promise<Record<string, Oop | null>> {
    const result: Record<string, Oop | null> = {};
    for (const key of keys) {
      result[key] = await this.getOop(key);
    }
    return result;
  }

  async pickObject<T = unknown>(keys: readonly string[]): Promise<Record<string, TypedOop<T> | null>> {
    const result: Record<string, TypedOop<T> | null> = {};
    try {
      for (const key of keys) {
        result[key] = await this.getObject<T>(key);
      }
      return result;
    } catch (error) {
      await releaseNullableHandles(Object.values(result));
      throw error;
    }
  }

  async pickDict(keys: readonly string[]): Promise<Record<string, GsDict | null>> {
    const result: Record<string, GsDict | null> = {};
    for (const key of keys) {
      result[key] = await this.getDict(key);
    }
    return result;
  }

  async entries(): Promise<Record<string, MarshalledValue>> {
    return this.pick(await this.keys());
  }

  async entriesOop(): Promise<Record<string, Oop | null>> {
    return this.pickOop(await this.keys());
  }

  async values(): Promise<MarshalledValue[]> {
    return (await this.items()).map(([, value]) => value);
  }

  async valuesOop(): Promise<Oop[]> {
    return (await this.itemsOop()).map(([, value]) => value);
  }

  async items(): Promise<Array<[string, MarshalledValue]>> {
    const result: Array<[string, MarshalledValue]> = [];
    for (const key of await this.keys()) {
      result.push([key, await this.get(key)]);
    }
    return result;
  }

  async itemsOop(): Promise<Array<[string, Oop]>> {
    const result: Array<[string, Oop]> = [];
    for (const key of await this.keys()) {
      const value = await this.getOop(key);
      if (value !== null) result.push([key, value]);
    }
    return result;
  }

  async requireOop(key: string): Promise<Oop> {
    const value = await this.getOop(key);
    if (value === null) throw this.#missingEntry(key);
    return value;
  }

  async requireAllOop(keys: readonly string[]): Promise<Record<string, Oop>> {
    const result: Record<string, Oop> = {};
    for (const key of keys) {
      result[key] = await this.requireOop(key);
    }
    return result;
  }

  async requireValue(key: string): Promise<MarshalledValue> {
    return this.session.marshalOop(await this.requireOop(key));
  }

  async requireAllValue(keys: readonly string[]): Promise<Record<string, MarshalledValue>> {
    const result: Record<string, MarshalledValue> = {};
    for (const key of keys) {
      result[key] = await this.requireValue(key);
    }
    return result;
  }

  async requireObject<T = unknown>(key: string): Promise<TypedOop<T>> {
    return this.session.typedOop<T>(await this.requireOop(key));
  }

  async requireAllObject<T = unknown>(keys: readonly string[]): Promise<Record<string, TypedOop<T>>> {
    const result: Record<string, TypedOop<T>> = {};
    try {
      for (const key of keys) {
        result[key] = await this.requireObject<T>(key);
      }
      return result;
    } catch (error) {
      await releaseNullableHandles(Object.values(result));
      throw error;
    }
  }

  async requireDict(key: string): Promise<GsDict> {
    return new GsDict(this.session, await this.requireOop(key));
  }

  async requireAllDict(keys: readonly string[]): Promise<Record<string, GsDict>> {
    const result: Record<string, GsDict> = {};
    for (const key of keys) {
      result[key] = await this.requireDict(key);
    }
    return result;
  }

  async require<T = unknown>(key: string): Promise<TypedOop<T>> {
    return this.requireObject<T>(key);
  }

  async requireAll<T = unknown>(keys: readonly string[]): Promise<Record<string, TypedOop<T>>> {
    return this.requireAllObject<T>(keys);
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

async function releaseNullableHandles(handles: Iterable<TypedOop<unknown> | null | undefined>): Promise<void> {
  const releases: Promise<void>[] = [];
  for (const handle of handles) {
    if (handle) releases.push(handle.release());
  }
  await Promise.allSettled(releases);
}

function toSafeSize(value: MarshalledValue): number {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`GemStone dictionary size is outside JavaScript's safe integer range: ${value}`);
    }
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`GemStone dictionary size must be a non-negative integer, got ${String(value)}.`);
}

function toBoolean(value: MarshalledValue, operation: string): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${operation} must answer a boolean, got ${String(value)}.`);
}
