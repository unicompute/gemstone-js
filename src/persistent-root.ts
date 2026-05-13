import { GsDict } from "./gsdict.ts";
import { ManagedOop, Session, TypedOop, type GemStoneArgument, type MarshalledValue } from "./client.ts";
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

  async getOop(name: string): Promise<Oop | null> {
    if (this.rootName === "UserGlobals") {
      return this.session.globalGetOop(name);
    }
    const root = await this.#root();
    const result = await this.session.runtime.symDictAt(root, name);
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

  async has(name: string): Promise<boolean> {
    return await this.getOop(name) !== null;
  }

  async set<T = unknown>(name: string, value: TypedOop<T> | ManagedOop<T> | Oop): Promise<void> {
    const root = await this.#root();
    const oop = typeof value === "bigint" ? value : value.oop;
    await this.session.runtime.symDictAtPut(root, name, oop);
  }

  async remove(name: string): Promise<boolean> {
    const root = await this.#root();
    const key = await this.session.newSymbol(name);
    const exists = await this.session.performValue(root, "includesKey:", key);
    if (!toBoolean(exists, "SymbolDictionary includesKey:")) return false;
    await this.session.perform(root, "removeKey:", key);
    return true;
  }

  async delete(name: string): Promise<boolean> {
    return this.remove(name);
  }

  async setValue(name: string, value: GemStoneArgument): Promise<void> {
    if (this.rootName === "UserGlobals") {
      await this.session.globalSet(name, value);
      return;
    }
    await this.set(name, await this.session.argumentToOop(value));
  }

  async getDict(name: string): Promise<GsDict | null> {
    const oop = await this.getOop(name);
    return oop === null ? null : new GsDict(this.session, oop);
  }

  async setDict(name: string, value: Record<string, GemStoneArgument>): Promise<GsDict> {
    const dict = await this.session.dictionary(value);
    await this.set(name, dict.oop);
    return dict;
  }

  async require<T = unknown>(name: string): Promise<TypedOop<T>> {
    return new TypedOop<T>(this.session, await this.requireOop(name));
  }

  async requireOop(name: string): Promise<Oop> {
    const value = await this.getOop(name);
    if (value === null) throw this.#missingEntry(name);
    return value;
  }

  async requireValue(name: string): Promise<MarshalledValue> {
    return this.session.marshalOop(await this.requireOop(name));
  }

  async requireDict(name: string): Promise<GsDict> {
    return new GsDict(this.session, await this.requireOop(name));
  }

  async entries(): Promise<Record<string, MarshalledValue>> {
    return this.pick(await this.keys());
  }

  async keys(): Promise<string[]> {
    return this.list();
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

function toBoolean(value: MarshalledValue, operation: string): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${operation} must answer a boolean, got ${String(value)}.`);
}
