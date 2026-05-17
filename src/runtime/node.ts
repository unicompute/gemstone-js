import { OOP_NIL, oop, type Oop } from "../oop.ts";
import type { GciErrorInfo, GciRuntime, LoginOptions, SymDictLookup } from "../types.ts";

type NativeModule = Record<string, unknown>;
type NativeGci = Record<string, unknown>;

const REQUIRED_SESSION_WORKER_METHODS = [
  "init",
  "encrypt",
  "setNet",
  "loginEx",
  "logout",
  "commit",
  "abort",
  "err",
  "executeStr",
  "perform",
  "newString",
  "newSymbol",
  "newOop",
  "resolveSymbol",
  "fetchClass",
  "fetchSize",
  "fetchBytes",
  "getSessionId",
  "setSessionId",
  "needsCommit",
  "inTransaction",
  "fltToOop",
  "oopToFlt",
  "symDictAt",
  "symDictAtPut",
  "symDictAtObjPut",
  "strKeyValueDictAt",
  "strKeyValueDictAtPut",
  "addOopToExportSet",
  "removeOopFromExportSet",
  "close",
] as const;

export interface NodeRuntimeOptions {
  nativeSessionWorker?: boolean;
  nativeModule?: NativeModule | Promise<NativeModule>;
  env?: Record<string, string | undefined>;
}

let nativeModulePromise: Promise<NativeModule> | undefined;

export function createNodeRuntime(options: NodeRuntimeOptions = {}): GciRuntime {
  let nativeGci: NativeGci | undefined;
  const useSessionWorker = options.nativeSessionWorker ?? nativeSessionWorkerFromEnv(options.env);

  async function call(method: string, ...args: unknown[]): Promise<unknown> {
    const native = await loadRuntimeNative(options);
    if (!nativeGci) await runtime.init();
    return optionalCall(nativeGci, native, method, { strictTarget: useSessionWorker }, ...args);
  }

  const runtime: GciRuntime = {
    name: useSessionWorker ? "node-worker" : "node",

    async init(libPath?: string): Promise<number | void> {
      const native = await loadRuntimeNative(options);
      if (!nativeGci) {
        nativeGci = await createNativeTarget(native, libPath, useSessionWorker);
      }
      return await optionalCall(nativeGci, native, "init", { strictTarget: useSessionWorker }, libPath) as number | void;
    },

    async encrypt(password: string): Promise<string> {
      return String(await call("encrypt", password));
    },

    async setNet(stoneName: string, hostUsername: string, encryptedHostPassword: string, gemService: string): Promise<void> {
      await call("setNet", stoneName, hostUsername, encryptedHostPassword, gemService);
    },

    async loginEx(options: LoginOptions): Promise<number> {
      const value = await call("loginEx", {
        ...options,
        halt_on_error: options.haltOnError,
      });
      return Number(value);
    },

    async logout(_sessionId?: number): Promise<void> {
      if (!nativeGci) return;
      const native = await loadRuntimeNative(options);
      try {
        await optionalCall(nativeGci, native, "logout", { strictTarget: useSessionWorker });
      } finally {
        await closeNativeTarget(nativeGci);
        nativeGci = undefined;
      }
    },

    async commit(): Promise<boolean> {
      return Boolean(await call("commit"));
    },

    async abort(): Promise<boolean> {
      return Boolean(await call("abort"));
    },

    async err(): Promise<GciErrorInfo | null> {
      const value = await call("err");
      return value ? normalizeNativeErrorInfo(value) : null;
    },

    async executeStr(source: string, receiver: Oop = OOP_NIL): Promise<Oop> {
      return oopFrom(await call("executeStr", source, receiver.toString()));
    },

    async perform(receiver: Oop, selector: string, args: Oop[] = []): Promise<Oop> {
      return oopFrom(await call("perform", receiver.toString(), selector, args.map((arg) => arg.toString())));
    },

    async newString(value: string): Promise<Oop> {
      return oopFrom(await call("newString", value));
    },

    async newSymbol(value: string): Promise<Oop> {
      return oopFrom(await call("newSymbol", value));
    },

    async newOop(classOop: Oop): Promise<Oop> {
      return oopFrom(await call("newOop", classOop.toString()));
    },

    async resolveSymbol(name: string, symbolList: Oop = OOP_NIL): Promise<Oop> {
      return oopFrom(await call("resolveSymbol", name, symbolList.toString()));
    },

    async fetchClass(value: Oop): Promise<Oop> {
      return oopFrom(await call("fetchClass", value.toString()));
    },

    async fetchSize(value: Oop): Promise<number> {
      return Number(await call("fetchSize", value.toString()));
    },

    async fetchBytes(value: Oop, start: number, count: number): Promise<Uint8Array> {
      const bytes = await call("fetchBytes", value.toString(), start, count);
      if (bytes instanceof Uint8Array) return bytes;
      if (Array.isArray(bytes)) return Uint8Array.from(bytes as number[]);
      if (isSerializedBuffer(bytes)) return Uint8Array.from(bytes.data);
      throw new TypeError("Expected native fetchBytes() to return Uint8Array.");
    },

    async getSessionId(): Promise<number> {
      return Number(await call("getSessionId"));
    },

    async setSessionId(sessionId: number): Promise<void> {
      await call("setSessionId", sessionId);
    },

    async needsCommit(): Promise<boolean> {
      return Boolean(await call("needsCommit"));
    },

    async inTransaction(): Promise<boolean> {
      return Boolean(await call("inTransaction"));
    },

    async fltToOop(value: number): Promise<Oop> {
      return oopFrom(await call("fltToOop", value));
    },

    async oopToFlt(value: Oop): Promise<number> {
      return Number(await call("oopToFlt", value.toString()));
    },

    async symDictAt(dict: Oop, key: string): Promise<SymDictLookup> {
      const result = await call("symDictAt", dict.toString(), key) as { value: bigint | number | string; assoc: bigint | number | string };
      return { value: oopFrom(result.value), assoc: oopFrom(result.assoc) };
    },

    async symDictAtPut(dict: Oop, key: string, value: Oop): Promise<void> {
      await call("symDictAtPut", dict.toString(), key, value.toString());
    },

    async symDictAtObjPut(dict: Oop, key: Oop, value: Oop): Promise<void> {
      await call("symDictAtObjPut", dict.toString(), key.toString(), value.toString());
    },

    async strKeyValueDictAt(dict: Oop, key: string): Promise<Oop> {
      return oopFrom(await call("strKeyValueDictAt", dict.toString(), key));
    },

    async strKeyValueDictAtPut(dict: Oop, key: string, value: Oop): Promise<void> {
      await call("strKeyValueDictAtPut", dict.toString(), key, value.toString());
    },

    async addOopToExportSet(value: Oop): Promise<void> {
      if (!nativeGci) await runtime.init();
      await optionalCall(nativeGci, await loadRuntimeNative(options), "addOopToExportSet", { strictTarget: useSessionWorker }, value.toString());
    },

    async removeOopFromExportSet(value: Oop): Promise<void> {
      if (!nativeGci) await runtime.init();
      await optionalCall(nativeGci, await loadRuntimeNative(options), "removeOopFromExportSet", { strictTarget: useSessionWorker }, value.toString());
    },
  };

  return runtime;
}

export const gci: GciRuntime = createNodeRuntime();

async function loadRuntimeNative(options: NodeRuntimeOptions): Promise<NativeModule> {
  return options.nativeModule ? await options.nativeModule : loadNative();
}

async function loadNative(): Promise<NativeModule> {
  nativeModulePromise ??= import("@gemstone-js/native").catch((error: unknown) => {
    throw new Error(
      "Cannot load @gemstone-js/native. Install the optional native package or inject a runtime with setGciRuntimeForTesting().",
      { cause: error },
    );
  }) as Promise<NativeModule>;
  return nativeModulePromise;
}

async function createNativeTarget(native: NativeModule, libPath: string | undefined, useSessionWorker: boolean): Promise<NativeGci> {
  if (useSessionWorker) {
    const createWorker = native.createGciSessionWorker as ((libPath?: string | null) => NativeGci) | undefined;
    if (!createWorker) {
      throw new Error(
        "@gemstone-js/native does not export createGciSessionWorker(). Update @gemstone-js/native to a worker-capable version or disable GS_NATIVE_SESSION_WORKER.",
      );
    }
    const worker = createWorker(libPath ?? null);
    const missingMethods = missingNativeTargetMethods(worker, REQUIRED_SESSION_WORKER_METHODS);
    if (missingMethods.length > 0) {
      await closeNativeTarget(worker).catch(() => undefined);
      throw new Error(`GciSessionWorker is missing required methods: ${missingMethods.join(", ")}.`);
    }
    return worker;
  }
  const Gci = native.Gci as { new (libPath?: string): NativeGci } | undefined;
  return Gci ? new Gci(libPath) : native;
}

function missingNativeTargetMethods(target: NativeGci, methods: readonly string[]): string[] {
  return methods.filter((method) => typeof target[method] !== "function");
}

async function closeNativeTarget(target: NativeGci): Promise<void> {
  const close = target.close as (() => unknown) | undefined;
  if (typeof close === "function") await close.call(target);
}

interface OptionalCallOptions {
  strictTarget?: boolean;
}

async function optionalCall(
  target: NativeGci | undefined,
  native: NativeModule,
  method: string,
  options: OptionalCallOptions,
  ...args: unknown[]
): Promise<unknown> {
  const { fn, receiver, owner } = resolveOptionalCallTarget(target, native, method, options);
  if (!fn) {
    throw new Error(`${owner} does not export ${method}().`);
  }
  return await fn.apply(receiver, args);
}

function resolveOptionalCallTarget(
  target: NativeGci | undefined,
  native: NativeModule,
  method: string,
  options: OptionalCallOptions,
): { fn: ((...args: unknown[]) => unknown) | undefined; receiver: NativeGci | NativeModule; owner: string } {
  if (options.strictTarget && target) {
    return {
      fn: typeof target[method] === "function" ? target[method] as (...args: unknown[]) => unknown : undefined,
      receiver: target,
      owner: "GciSessionWorker",
    };
  }
  if (target && typeof target[method] === "function") {
    return {
      fn: target[method] as (...args: unknown[]) => unknown,
      receiver: target,
      owner: "@gemstone-js/native",
    };
  }
  return {
    fn: typeof native[method] === "function" ? native[method] as (...args: unknown[]) => unknown : undefined,
    receiver: native,
    owner: "@gemstone-js/native",
  };
}

function nativeSessionWorkerFromEnv(env = defaultNodeEnv()): boolean {
  return envFlag(env.GS_NATIVE_SESSION_WORKER);
}

function defaultNodeEnv(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

function envFlag(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function normalizeNativeErrorInfo(value: unknown): GciErrorInfo {
  const raw = value as Partial<GciErrorInfo>;
  return {
    number: Number(raw.number ?? 0),
    fatal: Boolean(raw.fatal),
    message: String(raw.message ?? ""),
    reason: raw.reason === undefined ? undefined : String(raw.reason),
    category: raw.category === undefined ? undefined : oopFrom(raw.category),
    context: raw.context === undefined ? undefined : oopFrom(raw.context),
    exceptionObj: raw.exceptionObj === undefined ? undefined : oopFrom(raw.exceptionObj),
    args: Array.isArray(raw.args) ? raw.args.map(oopFrom) : undefined,
  };
}

function oopFrom(value: unknown): Oop {
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") {
    return oop(value);
  }
  throw new TypeError(`Expected OOP-compatible bigint, number, or string; got ${typeof value}.`);
}

function isSerializedBuffer(value: unknown): value is { data: number[] } {
  return Boolean(
    value
      && typeof value === "object"
      && Array.isArray((value as { data?: unknown }).data)
      && (value as { data: unknown[] }).data.every((item) => typeof item === "number"),
  );
}
