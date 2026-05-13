import { GsDict } from "./gsdict.ts";
import {
  ManagedOop,
  Session,
  TypedOop,
  type GemStoneArgument,
  type GemStoneDictionaryArgument,
  type MarshalledValue,
} from "./client.ts";
import { OOP_ILLEGAL, OOP_NIL, isIllegal, type Oop } from "./oop.ts";
import { validateGemStoneGlobalName } from "./smalltalk-source.ts";

export class PersistentRoot {
  readonly session: Session;
  readonly rootName: string;
  #rootOop: Promise<Oop> | undefined;

  constructor(session: Session, rootName = "UserGlobals") {
    this.session = session;
    this.rootName = validateGemStoneGlobalName(rootName, "persistent root name");
  }

  async get<T = unknown>(name: string): Promise<TypedOop<T> | null> {
    const oop = await this.getOop(name);
    return oop === null ? null : new TypedOop<T>(this.session, oop);
  }

  async getObject<T = unknown>(name: string): Promise<TypedOop<T> | null> {
    return this.get<T>(name);
  }

  async getOop(name: string): Promise<Oop | null> {
    const keyName = validatePersistentRootEntryName(name);
    if (this.rootName === "UserGlobals") {
      return this.session.globalGetOop(keyName);
    }
    const root = await this.#root();
    const result = await this.session.runtime.symDictAt(root, keyName);
    if (isIllegal(result.value) || result.value === OOP_NIL) return null;
    return result.value;
  }

  async getValue(name: string): Promise<MarshalledValue> {
    const oop = await this.getOop(name);
    return oop === null ? null : this.session.marshalOop(oop);
  }

  async pick(names: readonly string[]): Promise<Record<string, MarshalledValue>> {
    const result: Record<string, MarshalledValue> = {};
    for (const name of names) {
      result[name] = await this.getValue(name);
    }
    return result;
  }

  async pickOop(names: readonly string[]): Promise<Record<string, Oop | null>> {
    const result: Record<string, Oop | null> = {};
    for (const name of names) {
      result[name] = await this.getOop(name);
    }
    return result;
  }

  async pickObject<T = unknown>(names: readonly string[]): Promise<Record<string, TypedOop<T> | null>> {
    const result: Record<string, TypedOop<T> | null> = {};
    try {
      for (const name of names) {
        result[name] = await this.getObject<T>(name);
      }
      return result;
    } catch (error) {
      await releaseNullableHandles(Object.values(result));
      throw error;
    }
  }

  async pickDict(names: readonly string[]): Promise<Record<string, GsDict | null>> {
    const result: Record<string, GsDict | null> = {};
    for (const name of names) {
      result[name] = await this.getDict(name);
    }
    return result;
  }

  async has(name: string): Promise<boolean> {
    return await this.getOop(name) !== null;
  }

  async hasAll(names: readonly string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const name of names) {
      result[name] = await this.has(name);
    }
    return result;
  }

  async set<T = unknown>(name: string, value: TypedOop<T> | ManagedOop<T> | Oop): Promise<void> {
    const keyName = validatePersistentRootEntryName(name);
    const root = await this.#root();
    const oop = typeof value === "bigint" ? value : value.oop;
    await this.session.runtime.symDictAtPut(root, keyName, oop);
  }

  async setAll(values: Record<string, TypedOop<unknown> | ManagedOop<unknown> | Oop>): Promise<void> {
    for (const [name, value] of Object.entries(values)) {
      await this.set(name, value);
    }
  }

  async remove(name: string): Promise<boolean> {
    const keyName = validatePersistentRootEntryName(name);
    if (this.rootName === "UserGlobals") {
      return this.session.globalRemove(keyName);
    }
    const root = await this.#root();
    const key = await this.session.newSymbol(keyName);
    const exists = await this.session.performValue(root, "includesKey:", key);
    if (!toBoolean(exists, "SymbolDictionary includesKey:")) return false;
    await this.session.perform(root, "removeKey:", key);
    return true;
  }

  async delete(name: string): Promise<boolean> {
    return this.remove(name);
  }

  async removeAll(names: readonly string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const name of names) {
      result[name] = await this.remove(name);
    }
    return result;
  }

  async deleteAll(names: readonly string[]): Promise<Record<string, boolean>> {
    return this.removeAll(names);
  }

  async setValue(name: string, value: GemStoneArgument): Promise<void> {
    if (this.rootName === "UserGlobals") {
      await this.session.globalSet(name, value);
      return;
    }
    await this.set(name, await this.session.argumentToOop(value));
  }

  async setAllValue(values: Record<string, GemStoneArgument>): Promise<void> {
    for (const [name, value] of Object.entries(values)) {
      await this.setValue(name, value);
    }
  }

  async getDict(name: string): Promise<GsDict | null> {
    const oop = await this.getOop(name);
    return oop === null ? null : new GsDict(this.session, oop);
  }

  async setDict(name: string, value: GemStoneDictionaryArgument): Promise<GsDict> {
    const dict = await this.session.dictionary(value);
    await this.set(name, dict.oop);
    return dict;
  }

  async setAllDict(values: Record<string, GemStoneDictionaryArgument>): Promise<Record<string, GsDict>> {
    const result: Record<string, GsDict> = {};
    for (const [name, value] of Object.entries(values)) {
      result[name] = await this.setDict(name, value);
    }
    return result;
  }

  async require<T = unknown>(name: string): Promise<TypedOop<T>> {
    return new TypedOop<T>(this.session, await this.requireOop(name));
  }

  async requireObject<T = unknown>(name: string): Promise<TypedOop<T>> {
    return this.require<T>(name);
  }

  async requireOop(name: string): Promise<Oop> {
    const value = await this.getOop(name);
    if (value === null) throw this.#missingEntry(name);
    return value;
  }

  async requireAllOop(names: readonly string[]): Promise<Record<string, Oop>> {
    const result: Record<string, Oop> = {};
    for (const name of names) {
      result[name] = await this.requireOop(name);
    }
    return result;
  }

  async requireValue(name: string): Promise<MarshalledValue> {
    return this.session.marshalOop(await this.requireOop(name));
  }

  async requireAllValue(names: readonly string[]): Promise<Record<string, MarshalledValue>> {
    const result: Record<string, MarshalledValue> = {};
    for (const name of names) {
      result[name] = await this.requireValue(name);
    }
    return result;
  }

  async requireAllObject<T = unknown>(names: readonly string[]): Promise<Record<string, TypedOop<T>>> {
    const result: Record<string, TypedOop<T>> = {};
    try {
      for (const name of names) {
        result[name] = await this.requireObject<T>(name);
      }
      return result;
    } catch (error) {
      await releaseNullableHandles(Object.values(result));
      throw error;
    }
  }

  async requireAll<T = unknown>(names: readonly string[]): Promise<Record<string, TypedOop<T>>> {
    return this.requireAllObject<T>(names);
  }

  async requireDict(name: string): Promise<GsDict> {
    return new GsDict(this.session, await this.requireOop(name));
  }

  async requireAllDict(names: readonly string[]): Promise<Record<string, GsDict>> {
    const result: Record<string, GsDict> = {};
    for (const name of names) {
      result[name] = await this.requireDict(name);
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
      result.push([key, await this.getValue(key)]);
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

  async keys(): Promise<string[]> {
    return this.list();
  }

  async size(): Promise<number> {
    if (this.rootName === "UserGlobals") return this.session.globalSize();
    return toSafeSize(await this.session.eval(`${this.rootName} size`), this.rootName);
  }

  async isEmpty(): Promise<boolean> {
    return await this.size() === 0;
  }

  async list(): Promise<string[]> {
    const source = `
      | dict |
      dict := ${this.rootName}.
      String streamContents: [:stream |
        dict keysAndValuesDo: [:key :value |
          stream nextPutAll: key asString; lf]]
    `;
    const result = await this.session.eval(source);
    if (typeof result === "string") {
      return result.split(/\r?\n/).filter(Boolean);
    }
    return [];
  }

  async #root(): Promise<Oop> {
    this.#rootOop ??= this.session.resolveSymbol(this.rootName);
    const root = await this.#rootOop;
    if (root === OOP_ILLEGAL) throw new Error(`Cannot resolve GemStone persistent root ${this.rootName}.`);
    return root;
  }

  #missingEntry(name: string): Error {
    return new Error(`Persistent root ${this.rootName} has no entry named ${name}.`);
  }
}

async function releaseNullableHandles(handles: Iterable<TypedOop<unknown> | null | undefined>): Promise<void> {
  const releases: Promise<void>[] = [];
  for (const handle of handles) {
    if (handle) releases.push(handle.release());
  }
  await Promise.allSettled(releases);
}

function toBoolean(value: MarshalledValue, operation: string): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${operation} must answer a boolean, got ${String(value)}.`);
}

function toSafeSize(value: MarshalledValue, collection: string): number {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`${collection} size is outside JavaScript's safe integer range: ${value}`);
    }
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${collection} size must be a non-negative integer, got ${String(value)}.`);
}

function validatePersistentRootEntryName(name: string): string {
  return validateGemStoneGlobalName(name, "persistent root entry name");
}
