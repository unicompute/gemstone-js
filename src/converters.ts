import type { Session } from "./client.ts";
import type { Oop } from "./oop.ts";

type MaybePromise<T> = T | Promise<T>;

export interface ValueConverterOptions<T> {
  name: string;
  matches(value: unknown): value is T;
  toOop(session: Session, value: T): MaybePromise<Oop>;
  fromOop?: (session: Session, oop: Oop) => MaybePromise<T>;
}

export class ValueConverter<T = unknown> {
  readonly name: string;
  readonly #matches: (value: unknown) => value is T;
  readonly #toOop: (session: Session, value: T) => MaybePromise<Oop>;
  readonly #fromOop: ((session: Session, oop: Oop) => MaybePromise<T>) | undefined;

  constructor(options: ValueConverterOptions<T>) {
    if (!options.name) throw new TypeError("ValueConverter name is required.");
    this.name = options.name;
    this.#matches = options.matches;
    this.#toOop = options.toOop;
    this.#fromOop = options.fromOop;
  }

  matches(value: unknown): value is T {
    return this.#matches(value);
  }

  async toOop(session: Session, value: unknown): Promise<Oop> {
    if (!this.matches(value)) {
      throw new TypeError(`${this.name} cannot convert ${typeName(value)}.`);
    }
    return this.#toOop(session, value);
  }

  async fromOop(session: Session, oop: Oop): Promise<T> {
    if (!this.#fromOop) throw new TypeError(`${this.name} does not define fromOop conversion.`);
    return this.#fromOop(session, oop);
  }
}

export class ValueConverterRegistry {
  readonly #converters: ValueConverter<any>[];

  constructor(converters: Iterable<ValueConverter<any>> = []) {
    this.#converters = [...converters];
  }

  register(converter: ValueConverter<any>): void {
    this.#converters.push(converter);
  }

  extend(converters: Iterable<ValueConverter<any>>): void {
    for (const converter of converters) this.register(converter);
  }

  copy(): ValueConverterRegistry {
    return new ValueConverterRegistry(this.#converters);
  }

  converterFor(value: unknown): ValueConverter<any> | undefined {
    return this.#converters.find((converter) => converter.matches(value));
  }

  names(): string[] {
    return this.#converters.map((converter) => converter.name);
  }

  async toOop(session: Session, value: unknown): Promise<Oop> {
    const converter = this.converterFor(value);
    if (!converter) throw new TypeError(`No value converter registered for ${typeName(value)}.`);
    return converter.toOop(session, value);
  }

  async toOops(session: Session, values: Iterable<unknown>): Promise<Oop[]> {
    const oops: Oop[] = [];
    for (const value of values) oops.push(await this.toOop(session, value));
    return oops;
  }

  async fromOop<T = unknown>(name: string, session: Session, oop: Oop): Promise<T> {
    const converter = this.#converters.find((entry) => entry.name === name);
    if (!converter) throw new RangeError(`No value converter registered as ${name}.`);
    return converter.fromOop(session, oop) as Promise<T>;
  }

  async fromOops<T = unknown>(name: string, session: Session, oops: Iterable<Oop>): Promise<T[]> {
    const values: T[] = [];
    for (const oop of oops) values.push(await this.fromOop<T>(name, session, oop));
    return values;
  }
}

export function dateAsIsoStringConverter(): ValueConverter<Date> {
  return new ValueConverter<Date>({
    name: "date_iso_string",
    matches: (value): value is Date => value instanceof Date && !Number.isNaN(value.valueOf()),
    toOop: (session, value) => session.newString(value.toISOString()),
    fromOop: async (session, oop) => {
      const date = new Date(await session.fetchString(oop));
      if (Number.isNaN(date.valueOf())) throw new TypeError("GemStone string is not a valid ISO date.");
      return date;
    },
  });
}

export function scalarValueConverterRegistry(): ValueConverterRegistry {
  return new ValueConverterRegistry([dateAsIsoStringConverter()]);
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const constructorName = typeof value === "object" || typeof value === "function"
    ? value.constructor?.name
    : undefined;
  return constructorName ?? typeof value;
}
