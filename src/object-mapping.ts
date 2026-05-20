import type {
  GemStoneArgument,
  ManagedOop,
  MarshalledValue,
  Session,
  TypedOop,
} from "./client.ts";
import type { Oop } from "./oop.ts";
import type { GemStoneDumpOptions, GemStoneInspection, GemStoneObjectDump } from "./types.ts";

export type MappedSelectorSpec = readonly string[] | Readonly<Record<string, string>>;
export type MappedSnapshotKind = "value" | "oop" | "object" | "dict";

export interface MappedSnapshotField {
  selector?: string;
  kind?: MappedSnapshotKind;
  maxEntries?: number;
}

export type MappedSnapshotSpec<TShape = Record<string, unknown>> =
  | readonly (keyof TShape & string)[]
  | Readonly<Record<string, string | MappedSnapshotField>>;

export interface MappedObjectOptions<TShape = Record<string, unknown>> {
  selectors?: Readonly<Record<string, string>>;
  setters?: Readonly<Record<string, string>>;
  objectSelectors?: MappedSelectorSpec;
  oopSelectors?: MappedSelectorSpec;
  snapshot?: MappedSnapshotSpec<TShape>;
}

export interface TransparentObjectOptions<TShape = Record<string, unknown>>
  extends MappedObjectOptions<TShape> {
  cache?: boolean;
}

export interface MappedSnapshotOptions {
  maxEntries?: number;
}

export interface MappedObjectControls<TShape = Record<string, unknown>> {
  readonly $object: ManagedOop<TShape> | TypedOop<TShape>;
  readonly $session: Session;
  readonly $oop: Oop;
  $send<R = MarshalledValue>(selector: string, ...args: GemStoneArgument[]): Promise<R>;
  $sendOop(selector: string, ...args: GemStoneArgument[]): Promise<Oop>;
  $sendObject<R = unknown>(selector: string, ...args: GemStoneArgument[]): Promise<TypedOop<R>>;
  $set(property: string, value: GemStoneArgument): Promise<this>;
  $snapshot(
    spec?: MappedSnapshotSpec<TShape>,
    options?: MappedSnapshotOptions,
  ): Promise<Partial<TShape> & Record<string, unknown>>;
  $inspect(): Promise<GemStoneInspection>;
  $dump(options?: GemStoneDumpOptions): Promise<GemStoneObjectDump>;
  $printString(): Promise<string>;
  $release(): Promise<void>;
}

export type MappedObject<
  TShape = Record<string, unknown>,
  TMethods extends object = object,
> = MappedObjectControls<TShape> & {
  [K in keyof TShape & string]: () => Promise<TShape[K]>;
} & TMethods;

export interface TransparentMappedProperty<TValue = unknown> extends PromiseLike<TValue> {
  (): Promise<TValue>;
  value(): Promise<TValue>;
  refresh(): Promise<TValue>;
  send<R = MarshalledValue>(...args: GemStoneArgument[]): Promise<R>;
  oop(...args: GemStoneArgument[]): Promise<Oop>;
  object<R = unknown>(...args: GemStoneArgument[]): Promise<TypedOop<R>>;
}

export interface TransparentObjectControls<TShape = Record<string, unknown>>
  extends MappedObjectControls<TShape> {
  $assign(values: Partial<TShape> & Record<string, GemStoneArgument>): Promise<this>;
  $flush(): Promise<this>;
  $pending(): Promise<void>;
  $refresh(property?: keyof TShape & string): Promise<unknown>;
  $clearCache(...properties: readonly (keyof TShape & string)[]): this;
}

export type TransparentObject<
  TShape = Record<string, unknown>,
  TMethods extends object = object,
> = TransparentObjectControls<TShape> & {
  readonly [K in keyof TShape & string]: TransparentMappedProperty<TShape[K]>;
} & TMethods;

type MappedObjectSource<TShape> = ManagedOop<TShape> | TypedOop<TShape>;

export function mappedObject<
  TShape = Record<string, unknown>,
  TMethods extends object = object,
>(
  object: MappedObjectSource<TShape>,
  options: MappedObjectOptions<TShape> = {},
): MappedObject<TShape, TMethods> {
  let proxy: MappedObject<TShape, TMethods>;
  const controls: MappedObjectControls<TShape> = {
    $object: object,
    $session: object.session,
    $oop: object.oop,
    $send<R = MarshalledValue>(selector: string, ...args: GemStoneArgument[]): Promise<R> {
      return object.send<R>(selector, ...args);
    },
    $sendOop(selector: string, ...args: GemStoneArgument[]): Promise<Oop> {
      return object.sendOop(selector, ...args);
    },
    $sendObject<R = unknown>(selector: string, ...args: GemStoneArgument[]): Promise<TypedOop<R>> {
      return object.sendObject<R>(selector, ...args);
    },
    async $set(property: string, value: GemStoneArgument): Promise<MappedObjectControls<TShape>> {
      await object.send(selectorForSetter(property, options) ?? `${property}:`, value);
      return proxy;
    },
    $snapshot(
      spec: MappedSnapshotSpec<TShape> | undefined = options.snapshot,
      snapshotOptions: MappedSnapshotOptions = {},
    ): Promise<Partial<TShape> & Record<string, unknown>> {
      return snapshotMappedObject(object, spec, options, snapshotOptions);
    },
    $inspect(): Promise<GemStoneInspection> {
      return object.inspect();
    },
    $dump(dumpOptions: GemStoneDumpOptions = {}): Promise<GemStoneObjectDump> {
      return object.dump(dumpOptions);
    },
    $printString(): Promise<string> {
      return object.printString();
    },
    $release(): Promise<void> {
      return object.release();
    },
  };

  proxy = new Proxy(controls as MappedObject<TShape, TMethods>, {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      if (property === Symbol.asyncDispose) return controls.$release;
      if (property === Symbol.toStringTag) return "MappedObject";
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }
      if (property.startsWith("$")) return undefined;
      return (...args: GemStoneArgument[]) => invokeMappedMember(proxy, object, property, args, options);
    },
  });

  return proxy;
}

export function transparentObject<
  TShape = Record<string, unknown>,
  TMethods extends object = object,
>(
  object: MappedObjectSource<TShape>,
  options: TransparentObjectOptions<TShape> = {},
): TransparentObject<TShape, TMethods> {
  let proxy: TransparentObject<TShape, TMethods>;
  let writeTail: Promise<void> = Promise.resolve();
  let pendingWriteError: unknown;
  const readCache = new Map<string, Promise<unknown>>();
  const assignedValues = new Map<string, Promise<unknown>>();
  const accessorCache = new Map<string, TransparentMappedProperty>();

  const flushWrites = async (): Promise<void> => {
    await writeTail;
    if (pendingWriteError !== undefined) {
      const error = pendingWriteError;
      pendingWriteError = undefined;
      throw error;
    }
  };

  const queueWrite = (property: string, value: GemStoneArgument): void => {
    const selector = selectorForSetter(property, options) ?? `${property}:`;
    const write = writeTail.then(async () => {
      await object.send(selector, value);
    });
    const assigned = write.then(() => {
      if (options.cache) {
        readCache.set(property, Promise.resolve(value));
      } else {
        assignedValues.delete(property);
      }
      return value;
    });
    assigned.catch(() => undefined);
    assignedValues.set(property, assigned);
    writeTail = write.catch((error: unknown) => {
      assignedValues.delete(property);
      readCache.delete(property);
      pendingWriteError ??= error;
    });
  };

  const readProperty = async <TValue = unknown>(
    property: string,
    refresh = false,
  ): Promise<TValue> => {
    if (!refresh) {
      const assigned = assignedValues.get(property);
      if (assigned) return await assigned as TValue;
      const cached = readCache.get(property);
      if (cached) return await cached as TValue;
    }
    await flushWrites();
    const selector = selectorForProperty(property, 0, options);
    let value: Promise<unknown>;
    if (selectorFromSpec(options.objectSelectors, property)) {
      value = object.sendObject(selector);
    } else if (selectorFromSpec(options.oopSelectors, property)) {
      value = object.sendOop(selector);
    } else {
      value = object.send(selector);
    }
    if (options.cache) readCache.set(property, value);
    return await value as TValue;
  };

  const controls: TransparentObjectControls<TShape> = {
    $object: object,
    $session: object.session,
    $oop: object.oop,
    $send<R = MarshalledValue>(selector: string, ...args: GemStoneArgument[]): Promise<R> {
      return object.send<R>(selector, ...args);
    },
    $sendOop(selector: string, ...args: GemStoneArgument[]): Promise<Oop> {
      return object.sendOop(selector, ...args);
    },
    $sendObject<R = unknown>(selector: string, ...args: GemStoneArgument[]): Promise<TypedOop<R>> {
      return object.sendObject<R>(selector, ...args);
    },
    async $set(property: string, value: GemStoneArgument): Promise<TransparentObjectControls<TShape>> {
      queueWrite(property, value);
      await flushWrites();
      return proxy;
    },
    async $assign(
      values: Partial<TShape> & Record<string, GemStoneArgument>,
    ): Promise<TransparentObjectControls<TShape>> {
      for (const [property, value] of Object.entries(values)) {
        queueWrite(property, value as GemStoneArgument);
      }
      await flushWrites();
      return proxy;
    },
    async $flush(): Promise<TransparentObjectControls<TShape>> {
      await flushWrites();
      return proxy;
    },
    $pending(): Promise<void> {
      return writeTail.then(() => undefined);
    },
    $refresh(property?: keyof TShape & string): Promise<unknown> {
      if (property === undefined) {
        readCache.clear();
        assignedValues.clear();
        return flushWrites();
      }
      readCache.delete(property);
      assignedValues.delete(property);
      return readProperty(property, true);
    },
    $clearCache(...properties: readonly (keyof TShape & string)[]): TransparentObjectControls<TShape> {
      if (properties.length === 0) {
        readCache.clear();
        assignedValues.clear();
      } else {
        for (const property of properties) {
          readCache.delete(property);
          assignedValues.delete(property);
        }
      }
      return proxy;
    },
    $snapshot(
      spec: MappedSnapshotSpec<TShape> | undefined = options.snapshot,
      snapshotOptions: MappedSnapshotOptions = {},
    ): Promise<Partial<TShape> & Record<string, unknown>> {
      return flushWrites().then(() => snapshotMappedObject(object, spec, options, snapshotOptions));
    },
    $inspect(): Promise<GemStoneInspection> {
      return flushWrites().then(() => object.inspect());
    },
    $dump(dumpOptions: GemStoneDumpOptions = {}): Promise<GemStoneObjectDump> {
      return flushWrites().then(() => object.dump(dumpOptions));
    },
    $printString(): Promise<string> {
      return flushWrites().then(() => object.printString());
    },
    $release(): Promise<void> {
      return flushWrites().finally(() => object.release());
    },
  };

  proxy = new Proxy(controls as TransparentObject<TShape, TMethods>, {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      if (property === Symbol.asyncDispose) return controls.$release;
      if (property === Symbol.toStringTag) return "TransparentObject";
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }
      if (property.startsWith("$")) return undefined;
      let accessor = accessorCache.get(property);
      if (!accessor) {
        accessor = transparentAccessor(proxy, object, property, options, readProperty);
        accessorCache.set(property, accessor);
      }
      return accessor;
    },
    set(_target, property, value) {
      if (typeof property !== "string" || property.startsWith("$")) return false;
      queueWrite(property, value as GemStoneArgument);
      return true;
    },
  });

  return proxy;
}

export class TransparentObjectMapper {
  #cache = new WeakMap<Session, Map<string, TransparentObject>>();

  wrap<TShape = Record<string, unknown>, TMethods extends object = object>(
    object: MappedObjectSource<TShape>,
    options: TransparentObjectOptions<TShape> = {},
  ): TransparentObject<TShape, TMethods> {
    let sessionCache = this.#cache.get(object.session);
    if (!sessionCache) {
      sessionCache = new Map();
      this.#cache.set(object.session, sessionCache);
    }
    const key = object.oop.toString();
    const cached = sessionCache.get(key);
    if (cached) return cached as TransparentObject<TShape, TMethods>;
    const proxy = transparentObject<TShape, TMethods>(object, options);
    sessionCache.set(key, proxy as TransparentObject);
    return proxy;
  }

  delete(object: MappedObjectSource<unknown>): boolean {
    return this.#cache.get(object.session)?.delete(object.oop.toString()) ?? false;
  }

  clear(session?: Session): void {
    if (session) {
      this.#cache.delete(session);
      return;
    }
    this.#cache = new WeakMap();
  }
}

async function invokeMappedMember<TShape>(
  proxy: MappedObject<TShape>,
  object: MappedObjectSource<TShape>,
  property: string,
  args: GemStoneArgument[],
  options: MappedObjectOptions<TShape>,
): Promise<unknown> {
  const setter = selectorForSetter(property, options, true);
  if (setter) {
    await object.send(setter, ...args);
    return proxy;
  }
  const selector = selectorForProperty(property, args.length, options);
  if (selectorFromSpec(options.objectSelectors, property)) {
    return object.sendObject(selector, ...args);
  }
  if (selectorFromSpec(options.oopSelectors, property)) {
    return object.sendOop(selector, ...args);
  }
  return object.send(selector, ...args);
}

function transparentAccessor<TShape>(
  proxy: TransparentObject<TShape>,
  object: MappedObjectSource<TShape>,
  property: string,
  options: TransparentObjectOptions<TShape>,
  readProperty: <TValue = unknown>(property: string, refresh?: boolean) => Promise<TValue>,
): TransparentMappedProperty {
  const accessor = ((...args: GemStoneArgument[]) => {
    if (args.length === 0) return readProperty(property);
    return invokeTransparentMember(proxy, object, property, args, options);
  }) as TransparentMappedProperty;
  Object.defineProperties(accessor, {
    then: {
      value(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return readProperty(property).then(onFulfilled, onRejected);
      },
    },
    value: {
      value() {
        return readProperty(property);
      },
    },
    refresh: {
      value() {
        return readProperty(property, true);
      },
    },
    send: {
      value(...args: GemStoneArgument[]) {
        return invokeTransparentMember(proxy, object, property, args, options);
      },
    },
    oop: {
      value(...args: GemStoneArgument[]) {
        const selector = selectorForProperty(property, args.length, options);
        return object.sendOop(selector, ...args);
      },
    },
    object: {
      value(...args: GemStoneArgument[]) {
        const selector = selectorForProperty(property, args.length, options);
        return object.sendObject(selector, ...args);
      },
    },
  });
  return accessor;
}

async function invokeTransparentMember<TShape>(
  proxy: TransparentObject<TShape>,
  object: MappedObjectSource<TShape>,
  property: string,
  args: GemStoneArgument[],
  options: TransparentObjectOptions<TShape>,
): Promise<unknown> {
  const setter = selectorForSetter(property, options, true);
  if (setter) {
    await object.send(setter, ...args);
    return proxy;
  }
  const selector = selectorForProperty(property, args.length, options);
  if (selectorFromSpec(options.objectSelectors, property)) {
    return object.sendObject(selector, ...args);
  }
  if (selectorFromSpec(options.oopSelectors, property)) {
    return object.sendOop(selector, ...args);
  }
  return object.send(selector, ...args);
}

async function snapshotMappedObject<TShape>(
  object: MappedObjectSource<TShape>,
  spec: MappedSnapshotSpec<TShape> | undefined,
  options: MappedObjectOptions<TShape>,
  snapshotOptions: MappedSnapshotOptions,
): Promise<Partial<TShape> & Record<string, unknown>> {
  if (!spec) {
    throw new TypeError("Mapped object snapshot requires a field list or configured snapshot spec.");
  }
  const result: Record<string, unknown> = {};
  for (const field of snapshotFields(spec)) {
    const selector = field.selector ?? selectorForProperty(field.name, 0, options);
    const kind = field.kind ?? "value";
    if (kind === "oop") {
      result[field.name] = await object.sendOop(selector);
    } else if (kind === "object") {
      result[field.name] = await object.sendObject(selector);
    } else if (kind === "dict") {
      const dict = await object.sendOop(selector);
      result[field.name] = await object.session.dictionaryOopToObject(dict, {
        maxEntries: field.maxEntries ?? snapshotOptions.maxEntries,
      });
    } else {
      result[field.name] = await object.send(selector);
    }
  }
  return result as Partial<TShape> & Record<string, unknown>;
}

function snapshotFields<TShape>(
  spec: MappedSnapshotSpec<TShape>,
): Array<{ name: string; selector?: string; kind?: MappedSnapshotKind; maxEntries?: number }> {
  if (Array.isArray(spec)) {
    return spec.map((name) => ({ name }));
  }
  return Object.entries(spec).map(([name, value]) => {
    if (typeof value === "string") return { name, selector: value };
    return { name, ...value };
  });
}

function selectorForProperty<TShape>(
  property: string,
  arity: number,
  options: MappedObjectOptions<TShape>,
): string {
  const explicit = options.selectors?.[property];
  if (explicit) return explicit;
  const objectSelector = selectorFromSpec(options.objectSelectors, property);
  if (objectSelector) return objectSelector;
  const oopSelector = selectorFromSpec(options.oopSelectors, property);
  if (oopSelector) return oopSelector;
  if (arity === 0) return property;
  if (arity === 1) return `${property}:`;
  throw new Error(
    `Cannot infer GemStone selector for mapped object method ${property} with ${arity} arguments. ` +
      "Configure an explicit selector.",
  );
}

function selectorForSetter<TShape>(
  property: string,
  options: MappedObjectOptions<TShape>,
  optional = false,
): string | undefined {
  const explicit = options.setters?.[property];
  if (explicit) return explicit;
  const match = /^set([A-Z].*)$/.exec(property);
  if (match) return `${lowerFirst(match[1])}:`;
  if (optional) return undefined;
  return `${property}:`;
}

function selectorFromSpec(spec: MappedSelectorSpec | undefined, property: string): string | undefined {
  if (!spec) return undefined;
  if (Array.isArray(spec)) return (spec as readonly string[]).includes(property) ? property : undefined;
  return (spec as Readonly<Record<string, string>>)[property];
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toLowerCase()}${value.slice(1)}`;
}
