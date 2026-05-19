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
