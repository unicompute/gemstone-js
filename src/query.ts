import { Session, TypedOop, type MarshalledValue } from "./client.ts";
import { OOP_NIL, smallintToOop, type Oop } from "./oop.ts";
import { escapeSmalltalkStringLiteral, validateGemStoneGlobalName } from "./smalltalk-source.ts";

export type ComparisonOp = "=" | "==" | "!=" | "~=" | "<" | "<=" | ">" | ">=";
export type GSCollectionIndexKind = "equality";

export interface GSCollectionIndexOptions {
  kind?: GSCollectionIndexKind;
}

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

  async search(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<TypedOop<T>[]> {
    const result = await this.#searchResultArray(path, op, value);
    return result === OOP_NIL ? [] : this.#typedOopsFromArray(result);
  }

  async searchOop(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<Oop[]> {
    const result = await this.#searchResultArray(path, op, value);
    return result === OOP_NIL ? [] : this.#arrayOops(result);
  }

  async limit(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<TypedOop<T>[]> {
    const result = await this.#limitedResultArray(path, op, value, count);
    return result === OOP_NIL ? [] : this.#typedOopsFromArray(result);
  }

  async limitOop(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<Oop[]> {
    const result = await this.#limitedResultArray(path, op, value, count);
    return result === OOP_NIL ? [] : this.#arrayOops(result);
  }

  async take(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<TypedOop<T>[]> {
    return this.limit(path, op, value, count);
  }

  async takeOop(path: string, op: ComparisonOp, value: string | number | bigint | boolean, count: number): Promise<Oop[]> {
    return this.limitOop(path, op, value, count);
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
      | collection |
      collection := ${this.name}.
      (collection select: [:each | ${predicate}]) size
    `;
    return toSafeArraySize(await this.session.eval(source));
  }

  async exists(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<boolean> {
    return await this.count(path, op, value) > 0;
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
      results := (collection select: [:each | ${predicate}]) asArray.
      results size = 0
        ifTrue: [nil]
        ifFalse: [results copyFrom: 1 to: (${count} min: results size)]
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
