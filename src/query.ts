import { ManagedOop, Session, TypedOop, type GemStoneArgument, type MarshalledValue } from "./client.ts";
import { OOP_NIL, smallintToOop, type Oop } from "./oop.ts";
import { escapeSmalltalkStringLiteral, validateGemStoneGlobalName } from "./smalltalk-source.ts";

export type ComparisonOp = "=" | "==" | "!=" | "~=" | "<" | "<=" | ">" | ">=";
export type GSCollectionIndexKind = "equality";

export interface GSCollectionIndexOptions {
  kind?: GSCollectionIndexKind;
}

type OopHandle<T = unknown> = ManagedOop<T> | TypedOop<T> | Oop;

export class GSCollection<T = unknown> {
  readonly session: Session;
  readonly name: string;

  constructor(session: Session, name: string) {
    this.session = session;
    this.name = validateGemStoneGlobalName(name, "collection name");
  }

  async createEqualityIndexOn(path: string): Promise<void> {
    await this.session.execute(`${this.name} createEqualityIndexOn: '${escapeSmalltalkStringLiteral(path)}'`);
  }

  async removeEqualityIndexOn(path: string): Promise<void> {
    await this.session.execute(`${this.name} removeEqualityIndexOn: '${escapeSmalltalkStringLiteral(path)}'`);
  }

  async createIndexOn(path: string, options: GSCollectionIndexOptions = {}): Promise<void> {
    const selectors = selectorsForIndexKind(options.kind ?? "equality");
    await this.session.execute(`${this.name} ${selectors.create} '${escapeSmalltalkStringLiteral(path)}'`);
  }

  async removeIndexOn(path: string, options: GSCollectionIndexOptions = {}): Promise<void> {
    const selectors = selectorsForIndexKind(options.kind ?? "equality");
    await this.session.execute(`${this.name} ${selectors.remove} '${escapeSmalltalkStringLiteral(path)}'`);
  }

  async createIndex(path: string, options: GSCollectionIndexOptions = {}): Promise<void> {
    await this.createIndexOn(path, options);
  }

  async removeIndex(path: string, options: GSCollectionIndexOptions = {}): Promise<void> {
    await this.removeIndexOn(path, options);
  }

  async size(): Promise<number> {
    return toSafeArraySize(await this.session.eval(`${this.name} size`));
  }

  async isEmpty(): Promise<boolean> {
    return await this.size() === 0;
  }

  async add(value: GemStoneArgument): Promise<this> {
    await this.session.performWith(await this.#collectionOop(), "add:", value);
    return this;
  }

  async addAll(values: readonly GemStoneArgument[]): Promise<this> {
    const collection = await this.#collectionOop();
    for (const value of values) {
      await this.session.performWith(collection, "add:", value);
    }
    return this;
  }

  async addOop(value: OopHandle<T>): Promise<this> {
    await this.session.perform(await this.#collectionOop(), "add:", rawOop(value));
    return this;
  }

  async addAllOop(values: readonly OopHandle<T>[]): Promise<this> {
    const collection = await this.#collectionOop();
    for (const value of values) {
      await this.session.perform(collection, "add:", rawOop(value));
    }
    return this;
  }

  async includes(value: GemStoneArgument): Promise<boolean> {
    const collection = await this.#collectionOop();
    return this.#includesOop(collection, await this.session.argumentToOop(value));
  }

  async includesOop(value: OopHandle<T>): Promise<boolean> {
    return this.#includesOop(await this.#collectionOop(), rawOop(value));
  }

  async contains(value: GemStoneArgument): Promise<boolean> {
    return this.includes(value);
  }

  async containsOop(value: OopHandle<T>): Promise<boolean> {
    return this.includesOop(value);
  }

  async remove(value: GemStoneArgument): Promise<boolean> {
    const collection = await this.#collectionOop();
    return this.#removeOop(collection, await this.session.argumentToOop(value));
  }

  async removeOop(value: OopHandle<T>): Promise<boolean> {
    return this.#removeOop(await this.#collectionOop(), rawOop(value));
  }

  async delete(value: GemStoneArgument): Promise<boolean> {
    return this.remove(value);
  }

  async deleteOop(value: OopHandle<T>): Promise<boolean> {
    return this.removeOop(value);
  }

  async removeAll(values: readonly GemStoneArgument[]): Promise<number> {
    const collection = await this.#collectionOop();
    let removed = 0;
    for (const value of values) {
      if (await this.#removeOop(collection, await this.session.argumentToOop(value))) removed += 1;
    }
    return removed;
  }

  async removeAllOop(values: readonly OopHandle<T>[]): Promise<number> {
    const collection = await this.#collectionOop();
    let removed = 0;
    for (const value of values) {
      if (await this.#removeOop(collection, rawOop(value))) removed += 1;
    }
    return removed;
  }

  async clear(): Promise<this> {
    await this.session.perform(await this.#collectionOop(), "removeAll");
    return this;
  }

  async replaceAll(values: readonly GemStoneArgument[]): Promise<this> {
    const collection = await this.#collectionOop();
    await this.session.perform(collection, "removeAll");
    for (const value of values) {
      await this.session.performWith(collection, "add:", value);
    }
    return this;
  }

  async replaceAllOop(values: readonly OopHandle<T>[]): Promise<this> {
    const collection = await this.#collectionOop();
    await this.session.perform(collection, "removeAll");
    for (const value of values) {
      await this.session.perform(collection, "add:", rawOop(value));
    }
    return this;
  }

  async all(): Promise<TypedOop<T>[]> {
    return this.#typedOopsFromArray(await this.#allResultArray());
  }

  async allOop(): Promise<Oop[]> {
    return this.#arrayOops(await this.#allResultArray());
  }

  async allValues(): Promise<MarshalledValue[]> {
    return this.#valuesFromArray(await this.#allResultArray());
  }

  async page(start: number, count: number): Promise<TypedOop<T>[]> {
    const result = await this.#pageResultArray(start, count);
    return result === OOP_NIL ? [] : this.#typedOopsFromArray(result);
  }

  async pageOop(start: number, count: number): Promise<Oop[]> {
    const result = await this.#pageResultArray(start, count);
    return result === OOP_NIL ? [] : this.#arrayOops(result);
  }

  async pageValues(start: number, count: number): Promise<MarshalledValue[]> {
    const result = await this.#pageResultArray(start, count);
    return result === OOP_NIL ? [] : this.#valuesFromArray(result);
  }

  async at(index: number): Promise<TypedOop<T> | null> {
    const result = await this.atOop(index);
    return result === null ? null : this.session.typedOop<T>(result);
  }

  async atOop(index: number): Promise<Oop | null> {
    return this.#atOop(index);
  }

  async itemAt(index: number): Promise<TypedOop<T> | null> {
    return this.at(index);
  }

  async itemAtOop(index: number): Promise<Oop | null> {
    return this.atOop(index);
  }

  async atValue(index: number): Promise<MarshalledValue> {
    const result = await this.atOop(index);
    return result === null ? null : this.session.marshalOop(result);
  }

  async itemAtValue(index: number): Promise<MarshalledValue> {
    return this.atValue(index);
  }

  async firstItem(): Promise<TypedOop<T> | null> {
    const result = await this.firstItemOop();
    return result === null ? null : this.session.typedOop<T>(result);
  }

  async firstItemOop(): Promise<Oop | null> {
    return this.#edgeItemOop("first");
  }

  async firstItemValue(): Promise<MarshalledValue> {
    const result = await this.firstItemOop();
    return result === null ? null : this.session.marshalOop(result);
  }

  async lastItem(): Promise<TypedOop<T> | null> {
    const result = await this.lastItemOop();
    return result === null ? null : this.session.typedOop<T>(result);
  }

  async lastItemOop(): Promise<Oop | null> {
    return this.#edgeItemOop("last");
  }

  async lastItemValue(): Promise<MarshalledValue> {
    const result = await this.lastItemOop();
    return result === null ? null : this.session.marshalOop(result);
  }

  async search(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<TypedOop<T>[]> {
    const result = await this.#searchResultArray(path, op, value);
    return result === OOP_NIL ? [] : this.#typedOopsFromArray(result);
  }

  async searchOop(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<Oop[]> {
    const result = await this.#searchResultArray(path, op, value);
    return result === OOP_NIL ? [] : this.#arrayOops(result);
  }

  async searchValues(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<MarshalledValue[]> {
    const result = await this.#searchResultArray(path, op, value);
    return result === OOP_NIL ? [] : this.#valuesFromArray(result);
  }

  async limit(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<TypedOop<T>[]> {
    const result = await this.#limitedResultArray(path, op, value, count);
    return result === OOP_NIL ? [] : this.#typedOopsFromArray(result);
  }

  async limitOop(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<Oop[]> {
    const result = await this.#limitedResultArray(path, op, value, count);
    return result === OOP_NIL ? [] : this.#arrayOops(result);
  }

  async limitValues(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<MarshalledValue[]> {
    const result = await this.#limitedResultArray(path, op, value, count);
    return result === OOP_NIL ? [] : this.#valuesFromArray(result);
  }

  async take(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<TypedOop<T>[]> {
    return this.limit(path, op, value, count);
  }

  async takeOop(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<Oop[]> {
    return this.limitOop(path, op, value, count);
  }

  async takeValues(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<MarshalledValue[]> {
    return this.limitValues(path, op, value, count);
  }

  async first(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<TypedOop<T> | null> {
    const result = await this.firstOop(path, op, value);
    return result === null ? null : this.session.typedOop<T>(result);
  }

  async firstOop(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<Oop | null> {
    const predicate = await this.#predicate(path, op, value);
    const source = `
      | collection |
      collection := ${this.name}.
      collection detect: [:each | ${predicate}] ifNone: [nil]
    `;
    const result = await this.session.execute(source);
    return result === OOP_NIL ? null : result;
  }

  async count(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<number> {
    const predicate = await this.#predicate(path, op, value);
    const source = `
      | collection count |
      collection := ${this.name}.
      count := 0.
      collection do: [:each |
        ${predicate} ifTrue: [count := count + 1]].
      count
    `;
    return toSafeArraySize(await this.session.eval(source));
  }

  async exists(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<boolean> {
    const predicate = await this.#predicate(path, op, value);
    const source = `
      | collection |
      collection := ${this.name}.
      ((collection detect: [:each | ${predicate}] ifNone: [nil]) isNil) not
    `;
    return toBoolean(await this.session.eval(source), "GSCollection exists");
  }

  async #collectionOop(): Promise<Oop> {
    return this.session.execute(this.name);
  }

  async #includesOop(collection: Oop, value: Oop): Promise<boolean> {
    return toBoolean(await this.session.performValue(collection, "includes:", value), "GSCollection includes:");
  }

  async #removeOop(collection: Oop, value: Oop): Promise<boolean> {
    if (!await this.#includesOop(collection, value)) return false;
    await this.session.perform(collection, "remove:", value);
    return true;
  }

  async #allResultArray(): Promise<Oop> {
    return this.session.execute(`${this.name} asArray`);
  }

  async #pageResultArray(start: number, count: number): Promise<Oop> {
    start = normalizePageStart(start);
    count = normalizePageCount(count);
    if (count === 0) return OOP_NIL;
    const end = start + count - 1;
    const source = `
      | collection |
      collection := ${this.name} asArray.
      collection size < ${start}
        ifTrue: [nil]
        ifFalse: [collection copyFrom: ${start} to: (${end} min: collection size)]
    `;
    return this.session.execute(source);
  }

  async #atOop(index: number): Promise<Oop | null> {
    index = normalizeItemIndex(index);
    const source = `
      | collection |
      collection := ${this.name} asArray.
      ${index} > collection size
        ifTrue: [nil]
        ifFalse: [collection at: ${index}]
    `;
    const result = await this.session.execute(source);
    return result === OOP_NIL ? null : result;
  }

  async #edgeItemOop(selector: "first" | "last"): Promise<Oop | null> {
    const source = `
      | collection |
      collection := ${this.name} asArray.
      collection isEmpty
        ifTrue: [nil]
        ifFalse: [collection ${selector}]
    `;
    const result = await this.session.execute(source);
    return result === OOP_NIL ? null : result;
  }

  async #searchResultArray(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<Oop> {
    const predicate = await this.#predicate(path, op, value);
    const source = `
      | collection results |
      collection := ${this.name}.
      results := collection select: [:each | ${predicate}].
      results asArray
    `;
    return this.session.execute(source);
  }

  async #limitedResultArray(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<Oop> {
    count = normalizeLimitCount(count);
    if (count === 0) return OOP_NIL;
    const predicate = await this.#predicate(path, op, value);
    const source = `
      | collection results |
      collection := ${this.name}.
      results := OrderedCollection new.
      collection do: [:each |
        (results size < ${count} and: [${predicate}])
          ifTrue: [results add: each]].
      results size = 0
        ifTrue: [nil]
        ifFalse: [results asArray]
    `;
    return this.session.execute(source);
  }

  async #predicate(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<string> {
    const literal = await this.#literal(value);
    const selector = selectorForPath(path);
    return `(each ${selector} ${smalltalkOp(op)} ${literal})`;
  }

  async *iter(chunkSize = 256): AsyncIterable<TypedOop<T>> {
    for await (const oop of this.iterOop(chunkSize)) {
      yield new TypedOop<T>(this.session, oop);
    }
  }

  async *iterOop(chunkSize = 256): AsyncIterable<Oop> {
    chunkSize = normalizeChunkSize(chunkSize);
    let offset = 1;
    while (true) {
      const source = `
        | collection |
        collection := ${this.name} asArray.
        collection size < ${offset}
          ifTrue: [nil]
          ifFalse: [collection copyFrom: ${offset} to: (${offset + chunkSize - 1} min: collection size)]
      `;
      const result = await this.session.execute(source);
      if (result === OOP_NIL) return;
      const items = await this.#arrayOops(result);
      if (items.length === 0) return;
      for (const oop of items) {
        yield oop;
      }
      offset += chunkSize;
    }
  }

  async #literal(value: string | number | bigint | boolean): Promise<string> {
    if (typeof value === "string") return `'${escapeSmalltalkStringLiteral(value)}'`;
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new RangeError("GemStone query number literals must be finite.");
      return value.toString();
    }
    if (typeof value === "bigint") return value.toString();
    throw new TypeError(`Unsupported query literal: ${String(value)}`);
  }

  async #typedOopsFromArray(array: Oop): Promise<TypedOop<T>[]> {
    return (await this.#arrayOops(array)).map((oop) => new TypedOop<T>(this.session, oop));
  }

  async #arrayOops(array: Oop): Promise<Oop[]> {
    const size = toSafeArraySize(await this.session.performValue(array, "size"));
    const result: Oop[] = [];
    for (let index = 1; index <= size; index += 1) {
      result.push(await this.session.perform(array, "at:", smallintToOop(index)));
    }
    return result;
  }

  async #valuesFromArray(array: Oop): Promise<MarshalledValue[]> {
    const values: MarshalledValue[] = [];
    for (const oop of await this.#arrayOops(array)) {
      values.push(await this.session.marshalOop(oop));
    }
    return values;
  }
}

function selectorForPath(path: string): string {
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) throw new RangeError("GemStone query path must contain at least one selector.");
  for (const part of parts) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
      throw new RangeError(`Unsupported GemStone query path segment: ${part}`);
    }
  }
  return parts.join(" ");
}

function smalltalkOp(op: ComparisonOp): string {
  if (op === "==" || op === "=") return "=";
  if (op === "!=") return "~=";
  return op;
}

function selectorsForIndexKind(kind: GSCollectionIndexKind): { create: string; remove: string } {
  if (kind === "equality") {
    return {
      create: "createEqualityIndexOn:",
      remove: "removeEqualityIndexOn:",
    };
  }
  throw new RangeError(`Unsupported GemStone index kind: ${String(kind)}`);
}

function rawOop<T>(value: OopHandle<T>): Oop {
  return typeof value === "bigint" ? value : value.oop;
}

function normalizeChunkSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("GSCollection iterator chunkSize must be a positive safe integer.");
  }
  return value;
}

function normalizeLimitCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("GSCollection limit count must be a non-negative safe integer.");
  }
  return value;
}

function normalizePageStart(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("GSCollection page start must be a positive safe integer.");
  }
  return value;
}

function normalizePageCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("GSCollection page count must be a non-negative safe integer.");
  }
  return value;
}

function normalizeItemIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("GSCollection item index must be a positive safe integer.");
  }
  return value;
}

function toSafeArraySize(value: MarshalledValue): number {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`GemStone collection size is outside JavaScript's safe integer range: ${value}`);
    }
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`GemStone collection size must be a non-negative integer, got ${String(value)}.`);
}

function toBoolean(value: MarshalledValue, operation: string): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${operation} must answer a boolean, got ${String(value)}.`);
}
