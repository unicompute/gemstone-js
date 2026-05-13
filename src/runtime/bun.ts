import { OOP_NIL, type Oop } from "../oop.ts";
import type { GciErrorInfo, GciRuntime, LoginOptions, SymDictLookup } from "../types.ts";
import { cString, oopArray, oopFrom, outOop, readCString, validateFetchCount, validateFetchStart } from "./ffi-buffers.ts";
import { resolveGciLibraryPath } from "./library-discovery.ts";

type BunFFI = {
  dlopen: (path: string, symbols: unknown) => { symbols: Record<string, (...args: unknown[]) => unknown> };
  FFIType: Record<string, unknown>;
};
type NodeFs = {
  readdirSync?: (path: string) => string[];
};

let library: { symbols: Record<string, (...args: unknown[]) => unknown> } | undefined;

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

  async perform(receiver: Oop, selector: string, args: Oop[] = []): Promise<Oop> {
    const argBuffer = oopArray(args);
    return oopFrom(openLibrary().symbols.GciPerform(receiver, cString(selector), argBuffer, argBuffer.length));
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

  async fetchBytes(value: Oop, start: number, count: number): Promise<Uint8Array> {
    const validatedStart = validateFetchStart(start);
    const validatedCount = validateFetchCount(count);
    const bytes = new Uint8Array(validatedCount);
    const read = Number(openLibrary().symbols.GciFetchBytes_(value, validatedStart, bytes, validatedCount));
    if (read < 0) {
      throw new Error(`GciFetchBytes_ returned negative byte count ${read}.`);
    }
    return bytes.slice(0, Math.min(read, bytes.length));
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

  async oopToFlt(value: Oop): Promise<number> {
    const out = new Float64Array(1);
    const ok = Number(openLibrary().symbols.GciOopToFlt_(value, out));
    if (ok === 0) {
      throw new Error("OOP cannot be converted to Float.");
    }
    return out[0];
  },

  async symDictAt(dict: Oop, key: string): Promise<SymDictLookup> {
    const value = outOop();
    const assoc = outOop();
    openLibrary().symbols.GciSymDictAt(dict, cString(key), value, assoc);
    return { value: oopFrom(value[0]), assoc: oopFrom(assoc[0]) };
  },

  async symDictAtPut(dict: Oop, key: string, value: Oop): Promise<void> {
    openLibrary().symbols.GciSymDictAtPut(dict, cString(key), value);
  },

  async symDictAtObjPut(dict: Oop, key: Oop, value: Oop): Promise<void> {
    openLibrary().symbols.GciSymDictAtObjPut(dict, key, value);
  },

  async strKeyValueDictAt(dict: Oop, key: string): Promise<Oop> {
    const value = outOop();
    openLibrary().symbols.GciStrKeyValueDictAt(dict, cString(key), value);
    return oopFrom(value[0]);
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
  const require = (globalThis as { require?: (name: string) => unknown }).require;
  const ffi = require?.("bun:ffi") as BunFFI | undefined;
  if (!bun || !ffi) throw new Error("Bun runtime adapter loaded outside Bun.");
  const fs = require?.("node:fs") as NodeFs | undefined;
  const path = resolveGciLibraryPath(libPath, bun.env ?? {}, {
    listDir(dir) {
      try {
        return fs?.readdirSync?.(dir) ?? [];
      } catch {
        return [];
      }
    },
  });
  if (!path) throw new Error("Bun adapter cannot find libgcirpc. Pass libPath or set GS_LIB_PATH, GS_LIB, or GEMSTONE.");
  library = ffi.dlopen(path, symbols(ffi));
  return library;
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
    GciPerform: { args: [t.u64, t.ptr, t.ptr, t.i32], returns: t.u64 },
    GciNewString: { args: [t.ptr], returns: t.u64 },
    GciNewSymbol: { args: [t.ptr], returns: t.u64 },
    GciNewOop: { args: [t.u64], returns: t.u64 },
    GciFltToOop: { args: [t.f64], returns: t.u64 },
    GciOopToFlt_: { args: [t.u64, t.ptr], returns: t.i32 },
    GciFetchClass: { args: [t.u64], returns: t.u64 },
    GciFetchSize_: { args: [t.u64], returns: t.i64 },
    GciFetchBytes_: { args: [t.u64, t.i64, t.ptr, t.i64], returns: t.i64 },
    GciResolveSymbol: { args: [t.ptr, t.u64], returns: t.u64 },
    GciSymDictAt: { args: [t.u64, t.ptr, t.ptr, t.ptr], returns: t.void },
    GciSymDictAtPut: { args: [t.u64, t.ptr, t.u64], returns: t.void },
    GciSymDictAtObjPut: { args: [t.u64, t.u64, t.u64], returns: t.void },
    GciStrKeyValueDictAt: { args: [t.u64, t.ptr, t.ptr], returns: t.void },
    GciStrKeyValueDictAtPut: { args: [t.u64, t.ptr, t.u64], returns: t.void },
    GciGetSessionId: { args: [], returns: t.i32 },
    GciSetSessionId: { args: [t.i32], returns: t.void },
    GciNeedsCommit: { args: [], returns: t.i32 },
    GciInTransaction: { args: [], returns: t.i32 },
    GciAddOopToExportSet: { args: [t.u64], returns: t.void },
    GciRemoveOopFromExportSet: { args: [t.u64], returns: t.void },
  };
}
