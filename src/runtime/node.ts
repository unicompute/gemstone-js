import { OOP_NIL, oop, type Oop } from "../oop.ts";
import type { GciErrorInfo, GciRuntime, LoginOptions, SymDictLookup } from "../types.ts";

type NativeModule = Record<string, unknown>;
type NativeGci = Record<string, unknown>;

let nativeModulePromise: Promise<NativeModule> | undefined;

export function createNodeRuntime(): GciRuntime {
  let nativeGci: NativeGci | undefined;

  async function call(method: string, ...args: unknown[]): Promise<unknown> {
    const native = await loadNative();
    if (!nativeGci) await runtime.init();
    return optionalCall(nativeGci, native, method, ...args);
  }

  const runtime: GciRuntime = {
    name: "node",

    async init(libPath?: string): Promise<number | void> {
      const native = await loadNative();
      if (!nativeGci) {
        const Gci = native.Gci as { new (libPath?: string): NativeGci } | undefined;
        nativeGci = Gci ? new Gci(libPath) : native;
      }
      return await optionalCall(nativeGci, native, "init", libPath) as number | void;
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
      await call("logout");
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
      await optionalCall(nativeGci, await loadNative(), "addOopToExportSet", value.toString());
    },

    async removeOopFromExportSet(value: Oop): Promise<void> {
      if (!nativeGci) await runtime.init();
      await optionalCall(nativeGci, await loadNative(), "removeOopFromExportSet", value.toString());
    },
  };

  return runtime;
}

export const gci: GciRuntime = createNodeRuntime();

async function loadNative(): Promise<NativeModule> {
  nativeModulePromise ??= import("@gemstone-js/native").catch((error: unknown) => {
    throw new Error(
      "Cannot load @gemstone-js/native. Install the optional native package or inject a runtime with setGciRuntimeForTesting().",
      { cause: error },
    );
  }) as Promise<NativeModule>;
  return nativeModulePromise;
}

async function optionalCall(target: NativeGci | undefined, native: NativeModule, method: string, ...args: unknown[]): Promise<unknown> {
  const fn = (target?.[method] ?? native[method]) as ((...args: unknown[]) => unknown) | undefined;
  if (!fn) {
    throw new Error(`@gemstone-js/native does not export ${method}().`);
  }
  return await fn.apply(target ?? native, args);
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
