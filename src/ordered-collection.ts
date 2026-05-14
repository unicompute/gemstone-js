import { smallintToOop, type Oop } from "./oop.ts";
import { objectForOopSource } from "./smalltalk-source.ts";
import type { GemStoneArgument, ManagedOop, MarshalledValue, Session, TypedOop } from "./client.ts";
import type { GemStoneDumpOptions, GemStoneObjectDump, GemStoneInspection } from "./types.ts";

type OopHandle<T = unknown> = ManagedOop<T> | TypedOop<T> | Oop;

export class OrderedCollection<T = unknown> implements AsyncIterable<MarshalledValue> {
  readonly session: Session;
  readonly oop: Oop;
  readonly __classWitness?: T;

  constructor(session: Session, oop: Oop) {
    this.session = session;
    this.oop = oop;
  }

  static async create<T = unknown>(session: Session): Promise<OrderedCollection<T>> {
    const classOop = await session.resolveSymbol("OrderedCollection");
    return new OrderedCollection<T>(session, await session.perform(classOop, "new"));
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

  async size(): Promise<number> {
    return toSafeCollectionSize(await this.session.performValue(this.oop, "size"), "OrderedCollection");
  }

  async isEmpty(): Promise<boolean> {
    return await this.size() === 0;
  }

  async append(value: GemStoneArgument): Promise<this> {
    await this.session.performWith(this.oop, "add:", value);
    return this;
  }

  async appendValue(value: GemStoneArgument): Promise<this> {
    return this.append(value);
  }

  async appendOop(value: OopHandle<T>): Promise<this> {
    await this.session.perform(this.oop, "add:", rawHandleOop(value));
    return this;
  }

  async appendObject(value: OopHandle<T>): Promise<this> {
    return this.appendOop(value);
  }

  async extend(values: readonly GemStoneArgument[]): Promise<this> {
    if (values.length === 0) return this;
    await this.session.perform(this.oop, "addAll:", await this.session.arrayToOop(values));
    return this;
  }

  async extendValue(values: readonly GemStoneArgument[]): Promise<this> {
    return this.extend(values);
  }

  async extendOop(values: readonly OopHandle<T>[]): Promise<this> {
    if (values.length === 0) return this;
    await this.session.perform(this.oop, "addAll:", await this.#rawOopArray(values));
    return this;
  }

  async extendObject(values: readonly OopHandle<T>[]): Promise<this> {
    return this.extendOop(values);
  }

  async includes(value: GemStoneArgument): Promise<boolean> {
    return toBoolean(await this.session.performValueWith(this.oop, "includes:", value), "OrderedCollection includes:");
  }

  async includesOop(value: OopHandle<T>): Promise<boolean> {
    return toBoolean(await this.session.performValue(this.oop, "includes:", rawHandleOop(value)), "OrderedCollection includes:");
  }

  async contains(value: GemStoneArgument): Promise<boolean> {
    return this.includes(value);
  }

  async containsOop(value: OopHandle<T>): Promise<boolean> {
    return this.includesOop(value);
  }

  async remove(value: GemStoneArgument): Promise<boolean> {
    return this.#removeOop(await this.session.argumentToOop(value));
  }

  async removeOop(value: OopHandle<T>): Promise<boolean> {
    return this.#removeOop(rawHandleOop(value));
  }

  async delete(value: GemStoneArgument): Promise<boolean> {
    return this.remove(value);
  }

  async deleteOop(value: OopHandle<T>): Promise<boolean> {
    return this.removeOop(value);
  }

  async discard(value: GemStoneArgument): Promise<void> {
    await this.remove(value);
  }

  async discardOop(value: OopHandle<T>): Promise<void> {
    await this.removeOop(value);
  }

  async clear(): Promise<this> {
    await this.session.execute(`(${objectForOopSource(this.oop)}) removeAllSuchThat: [:each | true].`);
    return this;
  }

  async at(index: number): Promise<MarshalledValue> {
    const value = await this.atOop(index);
    return value === null ? null : this.session.marshalOop(value);
  }

  async atValue(index: number): Promise<MarshalledValue> {
    return this.at(index);
  }

  async atOop(index: number): Promise<Oop | null> {
    const oneBased = await this.#oneBasedIndex(index);
    return oneBased === null ? null : this.session.perform(this.oop, "at:", smallintToOop(oneBased));
  }

  async atObject<R = T>(index: number): Promise<TypedOop<R> | null> {
    const value = await this.atOop(index);
    return value === null ? null : this.session.typedOop<R>(value);
  }

  async first(): Promise<MarshalledValue> {
    const value = await this.firstOop();
    return value === null ? null : this.session.marshalOop(value);
  }

  async firstValue(): Promise<MarshalledValue> {
    return this.first();
  }

  async firstOop(): Promise<Oop | null> {
    return await this.isEmpty() ? null : this.session.perform(this.oop, "first");
  }

  async firstObject<R = T>(): Promise<TypedOop<R> | null> {
    const value = await this.firstOop();
    return value === null ? null : this.session.typedOop<R>(value);
  }

  async last(): Promise<MarshalledValue> {
    const value = await this.lastOop();
    return value === null ? null : this.session.marshalOop(value);
  }

  async lastValue(): Promise<MarshalledValue> {
    return this.last();
  }

  async lastOop(): Promise<Oop | null> {
    return await this.isEmpty() ? null : this.session.perform(this.oop, "last");
  }

  async lastObject<R = T>(): Promise<TypedOop<R> | null> {
    const value = await this.lastOop();
    return value === null ? null : this.session.typedOop<R>(value);
  }

  async pop(): Promise<MarshalledValue> {
    const value = await this.popOop();
    return value === null ? null : this.session.marshalOop(value);
  }

  async popValue(): Promise<MarshalledValue> {
    return this.pop();
  }

  async popOop(): Promise<Oop | null> {
    return await this.isEmpty() ? null : this.session.perform(this.oop, "removeLast");
  }

  async shift(): Promise<MarshalledValue> {
    const value = await this.shiftOop();
    return value === null ? null : this.session.marshalOop(value);
  }

  async shiftValue(): Promise<MarshalledValue> {
    return this.shift();
  }

  async shiftOop(): Promise<Oop | null> {
    return await this.isEmpty() ? null : this.session.perform(this.oop, "removeFirst");
  }

  async asArrayOop(): Promise<Oop> {
    return this.session.perform(this.oop, "asArray");
  }

  async values(): Promise<MarshalledValue[]> {
    return this.session.arrayOopToValues(await this.asArrayOop());
  }

  async toArray(): Promise<MarshalledValue[]> {
    return this.values();
  }

  async valuesOop(): Promise<Oop[]> {
    return this.session.arrayOopToOops(await this.asArrayOop());
  }

  async objects<R = T>(): Promise<TypedOop<R>[]> {
    return this.session.arrayOopToObjects<R>(await this.asArrayOop());
  }

  async inspect(): Promise<GemStoneInspection> {
    return this.session.inspect(this.oop);
  }

  async printString(): Promise<string> {
    return (await this.inspect()).printString;
  }

  async dump(options: GemStoneDumpOptions = {}): Promise<GemStoneObjectDump> {
    return this.session.dump(this.oop, options);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<MarshalledValue> {
    const size = await this.size();
    for (let index = 0; index < size; index += 1) {
      yield await this.at(index);
    }
  }

  async *reverseValues(): AsyncIterableIterator<MarshalledValue> {
    const size = await this.size();
    for (let index = size - 1; index >= 0; index -= 1) {
      yield await this.at(index);
    }
  }

  async #removeOop(value: Oop): Promise<boolean> {
    if (!await this.includesOop(value)) return false;
    await this.session.perform(this.oop, "remove:", value);
    return true;
  }

  async #rawOopArray(values: readonly OopHandle<T>[]): Promise<Oop> {
    const arrayClass = await this.session.resolveSymbol("Array");
    const array = await this.session.perform(arrayClass, "new:", smallintToOop(values.length));
    for (let index = 0; index < values.length; index += 1) {
      await this.session.perform(array, "at:put:", smallintToOop(index + 1), rawHandleOop(values[index]));
    }
    return array;
  }

  async #oneBasedIndex(index: number): Promise<number | null> {
    if (!Number.isSafeInteger(index)) {
      throw new RangeError("OrderedCollection index must be a safe integer.");
    }
    const size = await this.size();
    const normalized = index < 0 ? size + index : index;
    if (normalized < 0 || normalized >= size) return null;
    return normalized + 1;
  }
}

function rawHandleOop(value: OopHandle): Oop {
  return typeof value === "bigint" ? value : value.oop;
}

function toBoolean(value: MarshalledValue, operation: string): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${operation} must answer a boolean, got ${String(value)}.`);
}

function toSafeCollectionSize(value: MarshalledValue, collection: string): number {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`${collection} size is outside JavaScript's safe integer range: ${value}`);
    }
    return Number(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${collection} size must be a non-negative integer, got ${String(value)}.`);
}
