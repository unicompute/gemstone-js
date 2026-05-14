import type { GemStoneArgument, ManagedOop, MarshalledValue, Session, TypedOop } from "./client.ts";
import { OOP_NIL, oop, type Oop } from "./oop.ts";
import { objectForOopSource } from "./smalltalk-source.ts";

type OopHandle<T = unknown> = TypedOop<T> | ManagedOop<T> | Oop;
type CounterAmount = number | bigint;
type RcDictionaryEntries<T> = ReadonlyArray<readonly [GemStoneArgument, T]> | Readonly<Record<string, T>>;

export interface RcCounterDecrementOptions {
  ifLessThan?: CounterAmount;
  onLessThan?: () => void | Promise<void>;
}

export class RcCounter {
  readonly session: Session;
  readonly oop: Oop;

  constructor(session: Session, oop: Oop) {
    this.session = session;
    this.oop = oop;
  }

  static async create(session: Session): Promise<RcCounter> {
    return new RcCounter(session, await session.classRef("RcCounter").sendOop("new"));
  }

  static wrap(session: Session, oop: Oop): RcCounter {
    return new RcCounter(session, oop);
  }

  async value(): Promise<bigint> {
    return toBigInt(await this.sendValue("value"), "RcCounter value");
  }

  async increment(): Promise<this> {
    await this.sendValue("increment");
    return this;
  }

  async incrementBy(amount: CounterAmount): Promise<this> {
    await this.sendValue("incrementBy:", checkedCounterAmount(amount, "RcCounter increment amount"));
    return this;
  }

  async decrement(): Promise<this> {
    await this.sendValue("decrement");
    return this;
  }

  async decrementBy(amount: CounterAmount, options: RcCounterDecrementOptions = {}): Promise<this> {
    if (options.ifLessThan === undefined) {
      await this.sendValue("decrementBy:", checkedCounterAmount(amount, "RcCounter decrement amount"));
      return this;
    }

    const fired = await this.decrementByIfLessThan(amount, options.ifLessThan);
    if (fired) await options.onLessThan?.();
    return this;
  }

  async decrementByIfLessThan(amount: CounterAmount, guard: CounterAmount): Promise<boolean> {
    const source = `
      | counter fired |
      counter := ${objectForOopSource(this.oop)}.
      fired := false.
      counter
        decrementBy: ${counterLiteral(amount, "RcCounter decrement amount")}
        ifLessThan: ${counterLiteral(guard, "RcCounter decrement guard")}
        thenExecute: [fired := true].
      fired
    `;
    return toBoolean(await this.session.eval(source), "RcCounter guarded decrement");
  }

  async decrementIfNegative(amount: CounterAmount): Promise<this> {
    await this.sendValue("decrementIfNegative:", checkedCounterAmount(amount, "RcCounter decrement amount"));
    return this;
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
}

export class RcKeyValueDictionary {
  readonly session: Session;
  readonly oop: Oop;

  constructor(session: Session, oop: Oop) {
    this.session = session;
    this.oop = oop;
  }

  static async create(session: Session): Promise<RcKeyValueDictionary> {
    return new RcKeyValueDictionary(session, await session.classRef("RcKeyValueDictionary").sendOop("new"));
  }

  static wrap(session: Session, oop: Oop): RcKeyValueDictionary {
    return new RcKeyValueDictionary(session, oop);
  }

  async get(key: GemStoneArgument, defaultValue: GemStoneArgument = null): Promise<MarshalledValue> {
    const keyOop = await this.session.argumentToOop(key);
    const defaultOop = await this.session.argumentToOop(defaultValue);
    return this.session.marshalOop(await this.session.perform(this.oop, "at:otherwise:", keyOop, defaultOop));
  }

  async getValue(key: GemStoneArgument, defaultValue: GemStoneArgument = null): Promise<MarshalledValue> {
    return this.get(key, defaultValue);
  }

  async getOop(key: GemStoneArgument): Promise<Oop | null> {
    const keyOop = await this.session.argumentToOop(key);
    const value = await this.session.perform(this.oop, "at:otherwise:", keyOop, OOP_NIL);
    return value === OOP_NIL ? null : value;
  }

  async getObject<T = unknown>(key: GemStoneArgument): Promise<TypedOop<T> | null> {
    const value = await this.getOop(key);
    return value === null ? null : this.session.typedOop<T>(value);
  }

  async requireOop(key: GemStoneArgument): Promise<Oop> {
    const value = await this.getOop(key);
    if (value === null) throw new Error("GemStone reduced-conflict dictionary has no entry for key.");
    return value;
  }

  async requireObject<T = unknown>(key: GemStoneArgument): Promise<TypedOop<T>> {
    return this.session.typedOop<T>(await this.requireOop(key));
  }

  async require<T = unknown>(key: GemStoneArgument): Promise<TypedOop<T>> {
    return this.requireObject<T>(key);
  }

  async set(key: GemStoneArgument, value: GemStoneArgument): Promise<this> {
    await this.session.performValueWith(this.oop, "at:put:", key, value);
    return this;
  }

  async setValue(key: GemStoneArgument, value: GemStoneArgument): Promise<this> {
    return this.set(key, value);
  }

  async setAll(values: RcDictionaryEntries<GemStoneArgument>): Promise<this> {
    for (const [key, value] of dictionaryEntries(values)) {
      await this.set(key, value);
    }
    return this;
  }

  async setOop(key: GemStoneArgument, value: OopHandle): Promise<this> {
    await this.session.perform(this.oop, "at:put:", await this.session.argumentToOop(key), rawHandleOop(value));
    return this;
  }

  async setAllOop(values: RcDictionaryEntries<OopHandle>): Promise<this> {
    for (const [key, value] of dictionaryEntries(values)) {
      await this.setOop(key, value);
    }
    return this;
  }

  async remove(key: GemStoneArgument): Promise<boolean> {
    if (!await this.has(key)) return false;
    await this.session.performValueWith(this.oop, "removeKey:ifAbsent:", key, null);
    return true;
  }

  async delete(key: GemStoneArgument): Promise<boolean> {
    return this.remove(key);
  }

  async has(key: GemStoneArgument): Promise<boolean> {
    return toBoolean(await this.session.performValueWith(this.oop, "includesKey:", key), "RcKeyValueDictionary includesKey:");
  }

  async size(): Promise<number> {
    return toSafeNonNegativeInteger(await this.sendValue("size"), "RcKeyValueDictionary size");
  }

  async isEmpty(): Promise<boolean> {
    return toBoolean(await this.sendValue("isEmpty"), "RcKeyValueDictionary isEmpty");
  }

  async rebuildTable(size: number): Promise<this> {
    await this.sendValue("rebuildTable:", toPositiveSafeInteger(size, "RcKeyValueDictionary table size"));
    return this;
  }

  async keys(): Promise<MarshalledValue[]> {
    const values: MarshalledValue[] = [];
    for (const key of await this.keysOop()) {
      values.push(await this.session.marshalOop(key));
    }
    return values;
  }

  async keysOop(): Promise<Oop[]> {
    return (await this.itemsOop()).map(([key]) => key);
  }

  async values(): Promise<MarshalledValue[]> {
    const values: MarshalledValue[] = [];
    for (const value of await this.valuesOop()) {
      values.push(await this.session.marshalOop(value));
    }
    return values;
  }

  async valuesOop(): Promise<Oop[]> {
    return (await this.itemsOop()).map(([, value]) => value);
  }

  async items(): Promise<Array<[MarshalledValue, MarshalledValue]>> {
    const values: Array<[MarshalledValue, MarshalledValue]> = [];
    for (const [key, value] of await this.itemsOop()) {
      values.push([await this.session.marshalOop(key), await this.session.marshalOop(value)]);
    }
    return values;
  }

  async itemsOop(): Promise<Array<[Oop, Oop]>> {
    const source = `
      | dict |
      dict := ${objectForOopSource(this.oop)}.
      String streamContents: [:stream |
        dict associationsDo: [:assoc |
          stream
            nextPutAll: assoc key asOop asString;
            nextPut: $|;
            nextPutAll: assoc value asOop asString;
            lf]]
    `;
    return parseOopPairs(await this.session.eval(source), "RcKeyValueDictionary associationsDo:");
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
}

export class RcQueue {
  readonly session: Session;
  readonly oop: Oop;

  constructor(session: Session, oop: Oop) {
    this.session = session;
    this.oop = oop;
  }

  static async create(session: Session): Promise<RcQueue> {
    return new RcQueue(session, await session.classRef("RcQueue").sendOop("new"));
  }

  static wrap(session: Session, oop: Oop): RcQueue {
    return new RcQueue(session, oop);
  }

  async push(value: GemStoneArgument): Promise<this> {
    await this.session.performValueWith(this.oop, "add:", value);
    return this;
  }

  async add(value: GemStoneArgument): Promise<this> {
    return this.push(value);
  }

  async enq(value: GemStoneArgument): Promise<this> {
    return this.push(value);
  }

  async pushOop(value: OopHandle): Promise<this> {
    await this.session.perform(this.oop, "add:", rawHandleOop(value));
    return this;
  }

  async pushAll(values: readonly GemStoneArgument[]): Promise<this> {
    for (const value of values) {
      await this.push(value);
    }
    return this;
  }

  async pushAllOop(values: readonly OopHandle[]): Promise<this> {
    for (const value of values) {
      await this.pushOop(value);
    }
    return this;
  }

  async pop(): Promise<MarshalledValue> {
    return this.session.marshalOop(await this.popOop());
  }

  async shift(): Promise<MarshalledValue> {
    return this.pop();
  }

  async deq(): Promise<MarshalledValue> {
    return this.pop();
  }

  async popOop(): Promise<Oop> {
    return this.session.perform(this.oop, "remove");
  }

  async first(): Promise<MarshalledValue> {
    return this.session.marshalOop(await this.firstOop());
  }

  async peek(): Promise<MarshalledValue> {
    return this.first();
  }

  async firstOop(): Promise<Oop> {
    return this.session.perform(this.oop, "peek");
  }

  async at(index: number): Promise<MarshalledValue> {
    return this.session.marshalOop(await this.atOop(index));
  }

  async atOop(index: number): Promise<Oop> {
    return this.session.performWith(this.oop, "at:", toPositiveSafeInteger(index, "RcQueue index"));
  }

  async items(): Promise<MarshalledValue[]> {
    const values: MarshalledValue[] = [];
    for (const value of await this.itemsOop()) {
      values.push(await this.session.marshalOop(value));
    }
    return values;
  }

  async itemsOop(): Promise<Oop[]> {
    const size = await this.size();
    const values: Oop[] = [];
    for (let index = 1; index <= size; index += 1) {
      values.push(await this.atOop(index));
    }
    return values;
  }

  async size(): Promise<number> {
    return toSafeNonNegativeInteger(await this.sendValue("size"), "RcQueue size");
  }

  async isEmpty(): Promise<boolean> {
    return toBoolean(await this.sendValue("isEmpty"), "RcQueue isEmpty");
  }

  async clear(): Promise<this> {
    await this.sendValue("removeAll");
    return this;
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
}

export { RcCounter as RCCounter, RcKeyValueDictionary as RCHash, RcQueue as RCQueue };

function checkedCounterAmount(value: CounterAmount, field: string): number | bigint {
  if (typeof value === "bigint") return value;
  if (Number.isSafeInteger(value)) return value;
  throw new RangeError(`${field} must be a safe integer.`);
}

function counterLiteral(value: CounterAmount, field: string): string {
  const checked = checkedCounterAmount(value, field);
  return checked.toString();
}

function toBigInt(value: MarshalledValue, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new TypeError(`${field} must be an integer, got ${String(value)}.`);
}

function toBoolean(value: MarshalledValue, operation: string): boolean {
  if (typeof value === "boolean") return value;
  throw new TypeError(`${operation} must answer a boolean, got ${String(value)}.`);
}

function toSafeNonNegativeInteger(value: MarshalledValue, field: string): number {
  if (typeof value === "bigint") {
    if (value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  throw new RangeError(`${field} must be a non-negative safe integer, got ${String(value)}.`);
}

function toPositiveSafeInteger(value: number, field: string): number {
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new RangeError(`${field} must be a positive safe integer, got ${String(value)}.`);
}

function parseOopPairs(value: MarshalledValue, operation: string): Array<[Oop, Oop]> {
  if (typeof value !== "string") {
    throw new TypeError(`${operation} must answer an encoded string, got ${String(value)}.`);
  }
  const pairs: Array<[Oop, Oop]> = [];
  for (const line of value.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const [key, valueOop, extra] = line.split("|");
    if (extra !== undefined || key === undefined || valueOop === undefined || !/^-?\d+$/.test(key) || !/^-?\d+$/.test(valueOop)) {
      throw new Error(`${operation} answered an invalid OOP row: ${line}`);
    }
    pairs.push([oop(key), oop(valueOop)]);
  }
  return pairs;
}

function dictionaryEntries<T>(values: RcDictionaryEntries<T>): Array<[GemStoneArgument, T]> {
  return Array.isArray(values)
    ? values.map(([key, value]) => [key, value])
    : Object.entries(values);
}

function rawHandleOop<T>(value: OopHandle<T>): Oop {
  return typeof value === "bigint" ? value : value.oop;
}
