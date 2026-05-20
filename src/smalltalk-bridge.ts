import {
  type GemStoneArgument,
  type MarshalledValue,
  type Session,
  type TypedOop,
} from "./client.ts";
import { transparentObject, type TransparentObject, type TransparentObjectOptions } from "./object-mapping.ts";
import type { Oop } from "./oop.ts";
import { validateGemStoneGlobalName } from "./smalltalk-source.ts";

export interface SmalltalkSelectorDispatch<R = MarshalledValue> extends PromiseLike<R> {
  (...args: GemStoneArgument[]): Promise<R>;
  value(...args: GemStoneArgument[]): Promise<R>;
  oop(...args: GemStoneArgument[]): Promise<Oop>;
  object<T = unknown>(...args: GemStoneArgument[]): Promise<TypedOop<T>>;
  transparent<TShape = Record<string, unknown>, TMethods extends object = object>(
    ...args: GemStoneArgument[]
  ): Promise<TransparentObject<TShape, TMethods>>;
  transparentWith<TShape = Record<string, unknown>, TMethods extends object = object>(
    options: TransparentObjectOptions<TShape>,
    ...args: GemStoneArgument[]
  ): Promise<TransparentObject<TShape, TMethods>>;
}

export interface SmalltalkObjectControls {
  readonly $session: Session;
  readonly $name?: string;
  $oop(): Promise<Oop>;
  $send<R = MarshalledValue>(selector: string, ...args: GemStoneArgument[]): Promise<R>;
  $sendOop(selector: string, ...args: GemStoneArgument[]): Promise<Oop>;
  $sendObject<T = unknown>(selector: string, ...args: GemStoneArgument[]): Promise<TypedOop<T>>;
  $transparent<TShape = Record<string, unknown>, TMethods extends object = object>(
    options?: TransparentObjectOptions<TShape>,
  ): Promise<TransparentObject<TShape, TMethods>>;
  $clearCache(): this;
}

export type SmalltalkObject = SmalltalkObjectControls & Record<string, SmalltalkSelectorDispatch>;

export interface SmalltalkBridgeControls {
  readonly $session: Session;
  $resolve(name: string): SmalltalkObject;
  $global(name: string): SmalltalkObject;
  $send<R = MarshalledValue>(
    globalName: string,
    selector: string,
    ...args: GemStoneArgument[]
  ): Promise<R>;
  $sendOop(globalName: string, selector: string, ...args: GemStoneArgument[]): Promise<Oop>;
  $sendObject<T = unknown>(
    globalName: string,
    selector: string,
    ...args: GemStoneArgument[]
  ): Promise<TypedOop<T>>;
  $clearCache(name?: string): this;
}

export type SmalltalkBridge = SmalltalkBridgeControls & Record<string, SmalltalkObject>;

export interface SmalltalkBridgeOptions {
  cacheGlobals?: boolean;
}

export function smalltalkBridge(
  session: Session,
  options: SmalltalkBridgeOptions = {},
): SmalltalkBridge {
  const globals = new Map<string, SmalltalkObject>();
  let bridge: SmalltalkBridge;
  const controls: SmalltalkBridgeControls = {
    $session: session,
    $resolve(name: string): SmalltalkObject {
      const globalName = validateGemStoneGlobalName(name, "Smalltalk global name");
      const cached = globals.get(globalName);
      if (cached) return cached;
      const object = smalltalkObject(session, () => session.resolveSymbol(globalName), globalName);
      if (options.cacheGlobals ?? true) globals.set(globalName, object);
      return object;
    },
    $global(name: string): SmalltalkObject {
      return controls.$resolve(name);
    },
    $send<R = MarshalledValue>(
      globalName: string,
      selector: string,
      ...args: GemStoneArgument[]
    ): Promise<R> {
      return controls.$resolve(globalName).$send<R>(selector, ...args);
    },
    $sendOop(globalName: string, selector: string, ...args: GemStoneArgument[]): Promise<Oop> {
      return controls.$resolve(globalName).$sendOop(selector, ...args);
    },
    $sendObject<T = unknown>(
      globalName: string,
      selector: string,
      ...args: GemStoneArgument[]
    ): Promise<TypedOop<T>> {
      return controls.$resolve(globalName).$sendObject<T>(selector, ...args);
    },
    $clearCache(name?: string): SmalltalkBridgeControls {
      if (name === undefined) {
        globals.clear();
      } else {
        globals.delete(validateGemStoneGlobalName(name, "Smalltalk global name"));
      }
      return bridge;
    },
  };

  bridge = new Proxy(controls as SmalltalkBridge, {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      if (property === Symbol.toStringTag) return "SmalltalkBridge";
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      if (property in target) return Reflect.get(target, property, receiver);
      if (property.startsWith("$")) return undefined;
      return controls.$resolve(property);
    },
  });
  return bridge;
}

export function smalltalkObject(
  session: Session,
  resolveOop: Oop | (() => Promise<Oop>),
  name?: string,
): SmalltalkObject {
  const resolver = typeof resolveOop === "bigint"
    ? () => Promise.resolve(resolveOop)
    : resolveOop;
  let cachedOop: Promise<Oop> | undefined;
  const getOop = (): Promise<Oop> => {
    cachedOop ??= resolver();
    return cachedOop;
  };
  let proxy: SmalltalkObject;
  const selectorCache = new Map<string, SmalltalkSelectorDispatch>();
  const controls: SmalltalkObjectControls = {
    $session: session,
    $name: name,
    $oop(): Promise<Oop> {
      return getOop();
    },
    async $send<R = MarshalledValue>(selector: string, ...args: GemStoneArgument[]): Promise<R> {
      return await session.performValueWith(await getOop(), selector, ...args) as R;
    },
    async $sendOop(selector: string, ...args: GemStoneArgument[]): Promise<Oop> {
      return session.performWith(await getOop(), selector, ...args);
    },
    async $sendObject<T = unknown>(selector: string, ...args: GemStoneArgument[]): Promise<TypedOop<T>> {
      return session.performObjectWith<T>(await getOop(), selector, ...args);
    },
    async $transparent<TShape = Record<string, unknown>, TMethods extends object = object>(
      options: TransparentObjectOptions<TShape> = {},
    ): Promise<TransparentObject<TShape, TMethods>> {
      return transparentObject<TShape, TMethods>(session.typedOop<TShape>(await getOop()), options);
    },
    $clearCache(): SmalltalkObjectControls {
      cachedOop = undefined;
      selectorCache.clear();
      return proxy;
    },
  };

  proxy = new Proxy(controls as SmalltalkObject, {
    get(target, property, receiver) {
      if (property === "then") return undefined;
      if (property === Symbol.toStringTag) return "SmalltalkObject";
      if (typeof property !== "string") return Reflect.get(target, property, receiver);
      if (property in target) return Reflect.get(target, property, receiver);
      if (property.startsWith("$")) return undefined;
      let dispatch = selectorCache.get(property);
      if (!dispatch) {
        dispatch = selectorDispatch(controls, smalltalkSelectorForProperty(property));
        selectorCache.set(property, dispatch);
      }
      return dispatch;
    },
  });
  return proxy;
}

export function smalltalkSelectorForProperty(name: string): string {
  if (!name || name.startsWith("__")) {
    throw new TypeError(`Invalid Smalltalk selector property: ${name}`);
  }
  return name.includes("_") ? name.replaceAll("_", ":") : name;
}

function selectorDispatch(
  object: SmalltalkObjectControls,
  selector: string,
): SmalltalkSelectorDispatch {
  const dispatch = ((...args: GemStoneArgument[]) => object.$send(selector, ...args)) as SmalltalkSelectorDispatch;
  Object.defineProperties(dispatch, {
    then: {
      value(onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return object.$send(selector).then(onFulfilled, onRejected);
      },
    },
    value: {
      value(...args: GemStoneArgument[]) {
        return object.$send(selector, ...args);
      },
    },
    oop: {
      value(...args: GemStoneArgument[]) {
        return object.$sendOop(selector, ...args);
      },
    },
    object: {
      value(...args: GemStoneArgument[]) {
        return object.$sendObject(selector, ...args);
      },
    },
    transparent: {
      async value<TShape = Record<string, unknown>, TMethods extends object = object>(
        ...args: GemStoneArgument[]
      ): Promise<TransparentObject<TShape, TMethods>> {
        const handle = await object.$sendObject<TShape>(selector, ...args);
        return transparentObject<TShape, TMethods>(handle);
      },
    },
    transparentWith: {
      async value<TShape = Record<string, unknown>, TMethods extends object = object>(
        options: TransparentObjectOptions<TShape>,
        ...args: GemStoneArgument[]
      ): Promise<TransparentObject<TShape, TMethods>> {
        const handle = await object.$sendObject<TShape>(selector, ...args);
        return transparentObject<TShape, TMethods>(handle, options);
      },
    },
  });
  return dispatch;
}
