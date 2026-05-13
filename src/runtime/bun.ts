import { OOP_NIL, oop, type Oop } from "../oop.ts";
import type { GciErrorInfo, GciRuntime, LoginOptions, SymDictLookup } from "../types.ts";

type BunFFI = {
  dlopen: (path: string, symbols: unknown) => { symbols: Record<string, (...args: unknown[]) => unknown> };
  FFIType: Record<string, unknown>;
};

let library: { symbols: Record<string, (...args: unknown[]) => unknown> } | undefined;
const encoder = new TextEncoder();

export function createBunRuntime(): GciRuntime {
  return gci;
}

export const gci: GciRuntime = {
  name: "bun",

  async init(libPath?: string): Promise<number | void> {
    return Number(openLibrary(libPath).symbols.GciInit());
  },

  async encrypt(password: string): Promise<string> {
    const buffer = new Uint8Array(1024);
    openLibrary().symbols.GciEncrypt(cString(password), buffer, buffer.byteLength);
    return readCString(buffer);
  },

  async setNet(stoneName: string, hostUsername: string, encryptedHostPassword: string, gemService: string): Promise<void> {
    openLibrary().symbols.GciSetNet(
      cString(stoneName),
      cString(hostUsername),
      cString(encryptedHostPassword),
      cString(gemService),
    );
  },

  async loginEx(options: LoginOptions): Promise<number> {
    return Number(openLibrary().symbols.GciLoginEx(
      cString(options.username),
      cString(options.password),
      options.flags ?? 0,
      options.haltOnError ? 1 : 0,
    ));
  },

  async logout(): Promise<void> {
    openLibrary().symbols.GciLogout();
  },

  async commit(): Promise<boolean> {
    return Boolean(openLibrary().symbols.GciCommit(null));
  },

  async abort(): Promise<boolean> {
    return Boolean(openLibrary().symbols.GciAbort(null));
  },

  async err(): Promise<GciErrorInfo | null> {
    throw new Error("Bun GciErr struct decoding is not implemented yet.");
  },

  async executeStr(source: string, receiver: Oop = OOP_NIL): Promise<Oop> {
    return oopFrom(openLibrary().symbols.GciExecuteStr(cString(source), receiver));
  },

  async perform(_receiver: Oop, _selector: string, _args: Oop[] = []): Promise<Oop> {
    throw new Error("Bun GciPerform pointer-array marshalling is not implemented yet.");
  },

  async newString(value: string): Promise<Oop> {
    return oopFrom(openLibrary().symbols.GciNewString(cString(value)));
  },

  async newSymbol(value: string): Promise<Oop> {
    return oopFrom(openLibrary().symbols.GciNewSymbol(cString(value)));
  },

  async newOop(classOop: Oop): Promise<Oop> {
    return oopFrom(openLibrary().symbols.GciNewOop(classOop));
  },

  async resolveSymbol(name: string, symbolList: Oop = OOP_NIL): Promise<Oop> {
    return oopFrom(openLibrary().symbols.GciResolveSymbol(cString(name), symbolList));
  },

  async fetchClass(value: Oop): Promise<Oop> {
    return oopFrom(openLibrary().symbols.GciFetchClass(value));
  },

  async fetchSize(value: Oop): Promise<number> {
    return Number(openLibrary().symbols.GciFetchSize_(value));
  },

  async fetchBytes(_value: Oop, _start: number, _count: number): Promise<Uint8Array> {
    throw new Error("Bun GciFetchBytes_ buffer marshalling is not implemented yet.");
  },

  async getSessionId(): Promise<number> {
    return Number(openLibrary().symbols.GciGetSessionId());
  },

  async setSessionId(sessionId: number): Promise<void> {
    openLibrary().symbols.GciSetSessionId(sessionId);
  },

  async needsCommit(): Promise<boolean> {
    return Boolean(openLibrary().symbols.GciNeedsCommit());
  },

  async inTransaction(): Promise<boolean> {
    return Boolean(openLibrary().symbols.GciInTransaction());
  },

  async fltToOop(value: number): Promise<Oop> {
    return oopFrom(openLibrary().symbols.GciFltToOop(value));
  },

  async oopToFlt(_value: Oop): Promise<number> {
    throw new Error("Bun GciOopToFlt_ out-parameter marshalling is not implemented yet.");
  },

  async symDictAt(_dict: Oop, _key: string): Promise<SymDictLookup> {
    throw new Error("Bun GciSymDictAt out-parameter marshalling is not implemented yet.");
  },

  async symDictAtPut(dict: Oop, key: string, value: Oop): Promise<void> {
    openLibrary().symbols.GciSymDictAtPut(dict, cString(key), value);
  },

  async symDictAtObjPut(dict: Oop, key: Oop, value: Oop): Promise<void> {
    openLibrary().symbols.GciSymDictAtObjPut(dict, key, value);
  },

  async strKeyValueDictAt(_dict: Oop, _key: string): Promise<Oop> {
    throw new Error("Bun GciStrKeyValueDictAt out-parameter marshalling is not implemented yet.");
  },

  async strKeyValueDictAtPut(dict: Oop, key: string, value: Oop): Promise<void> {
    openLibrary().symbols.GciStrKeyValueDictAtPut(dict, cString(key), value);
  },

  async addOopToExportSet(value: Oop): Promise<void> {
    openLibrary().symbols.GciAddOopToExportSet?.(value);
  },

  async removeOopFromExportSet(value: Oop): Promise<void> {
    openLibrary().symbols.GciRemoveOopFromExportSet?.(value);
  },
};

function openLibrary(libPath?: string): { symbols: Record<string, (...args: unknown[]) => unknown> } {
  if (library) return library;
  const bun = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun;
  const ffi = (globalThis as { require?: (name: string) => BunFFI }).require?.("bun:ffi");
  if (!bun || !ffi) throw new Error("Bun runtime adapter loaded outside Bun.");
  const path = libPath ?? bun.env?.GS_LIB_PATH ?? bun.env?.GS_LIB;
  if (!path) throw new Error("Bun adapter needs libPath or GS_LIB_PATH for libgcirpc.");
  library = ffi.dlopen(path, symbols(ffi));
  return library;
}

function cString(value: string): Uint8Array {
  const bytes = encoder.encode(value);
  const out = new Uint8Array(bytes.byteLength + 1);
  out.set(bytes);
  return out;
}

function readCString(value: Uint8Array): string {
  const end = value.indexOf(0);
  return new TextDecoder().decode(end === -1 ? value : value.subarray(0, end));
}

function oopFrom(value: unknown): Oop {
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") {
    return oop(value);
  }
  throw new TypeError(`Expected OOP-compatible bigint, number, or string; got ${typeof value}.`);
}

function symbols(ffi: BunFFI): Record<string, unknown> {
  const t = ffi.FFIType;
  return {
    GciInit: { args: [], returns: t.i32 },
    GciSetNet: { args: [t.ptr, t.ptr, t.ptr, t.ptr], returns: t.void },
    GciEncrypt: { args: [t.ptr, t.ptr, t.u32], returns: t.ptr },
    GciLoginEx: { args: [t.ptr, t.ptr, t.u32, t.i32], returns: t.i32 },
    GciLogout: { args: [], returns: t.i32 },
    GciCommit: { args: [t.ptr], returns: t.i32 },
    GciAbort: { args: [t.ptr], returns: t.i32 },
    GciExecuteStr: { args: [t.ptr, t.u64], returns: t.u64 },
    GciNewString: { args: [t.ptr], returns: t.u64 },
    GciNewSymbol: { args: [t.ptr], returns: t.u64 },
    GciNewOop: { args: [t.u64], returns: t.u64 },
    GciFltToOop: { args: [t.f64], returns: t.u64 },
    GciFetchClass: { args: [t.u64], returns: t.u64 },
    GciFetchSize_: { args: [t.u64], returns: t.i64 },
    GciResolveSymbol: { args: [t.ptr, t.u64], returns: t.u64 },
    GciSymDictAtPut: { args: [t.u64, t.ptr, t.u64], returns: t.void },
    GciSymDictAtObjPut: { args: [t.u64, t.u64, t.u64], returns: t.void },
    GciStrKeyValueDictAtPut: { args: [t.u64, t.ptr, t.u64], returns: t.void },
    GciGetSessionId: { args: [], returns: t.i32 },
    GciSetSessionId: { args: [t.i32], returns: t.void },
    GciNeedsCommit: { args: [], returns: t.i32 },
    GciInTransaction: { args: [], returns: t.i32 },
    GciAddOopToExportSet: { args: [t.u64], returns: t.void },
    GciRemoveOopFromExportSet: { args: [t.u64], returns: t.void },
  };
}
