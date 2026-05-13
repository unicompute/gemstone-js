import { OOP_NIL, oop, type Oop } from "../oop.ts";
import type { GciErrorInfo, GciRuntime, LoginOptions, SymDictLookup } from "../types.ts";
import { resolveGciLibraryPath } from "./library-discovery.ts";

type DenoLibrary = {
  symbols: Record<string, (...args: unknown[]) => unknown>;
  close(): void;
};

let library: DenoLibrary | undefined;
const encoder = new TextEncoder();

export function createDenoRuntime(): GciRuntime {
  return gci;
}

export const gci: GciRuntime = {
  name: "deno",

  async init(libPath?: string): Promise<number | void> {
    const lib = openLibrary(libPath);
    return Number(lib.symbols.GciInit());
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
    throw new Error("Deno GciErr struct decoding is not implemented yet.");
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

function openLibrary(libPath?: string): DenoLibrary {
  if (library) return library;
  const deno = (globalThis as {
    Deno?: {
      dlopen: (path: string, symbols: unknown) => DenoLibrary;
      env?: { get(key: string): string | undefined };
      readDirSync?: (path: string) => Iterable<{ name: string }>;
    };
  }).Deno;
  if (!deno) throw new Error("Deno runtime adapter loaded outside Deno.");
  const path = resolveGciLibraryPath(libPath, denoEnv(deno), {
    listDir(dir) {
      try {
        return Array.from(deno.readDirSync?.(dir) ?? [], (entry) => entry.name);
      } catch {
        return [];
      }
    },
  });
  if (!path) throw new Error("Deno adapter cannot find libgcirpc. Pass libPath or set GS_LIB_PATH, GS_LIB, or GEMSTONE.");
  library = deno.dlopen(path, symbols);
  return library;
}

function denoEnv(deno: { env?: { get(key: string): string | undefined } }): Record<string, string | undefined> {
  return {
    GS_LIB_PATH: deno.env?.get("GS_LIB_PATH"),
    GS_LIB: deno.env?.get("GS_LIB"),
    GEMSTONE: deno.env?.get("GEMSTONE"),
  };
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

function oopArray(values: readonly Oop[]): BigUint64Array {
  const out = new BigUint64Array(values.length);
  values.forEach((value, index) => {
    out[index] = BigInt.asUintN(64, value);
  });
  return out;
}

function outOop(): BigUint64Array {
  return new BigUint64Array(1);
}

function oopFrom(value: unknown): Oop {
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") {
    return oop(value);
  }
  throw new TypeError(`Expected OOP-compatible bigint, number, or string; got ${typeof value}.`);
}

function validateFetchStart(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("fetchBytes start must be a positive safe integer.");
  }
  return value;
}

function validateFetchCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("fetchBytes count must be a non-negative safe integer.");
  }
  return value;
}

const symbols = {
  GciInit: { parameters: [], result: "i32" },
  GciSetNet: { parameters: ["buffer", "buffer", "buffer", "buffer"], result: "void" },
  GciEncrypt: { parameters: ["buffer", "buffer", "u32"], result: "pointer" },
  GciLoginEx: { parameters: ["buffer", "buffer", "u32", "i32"], result: "i32" },
  GciLogout: { parameters: [], result: "i32" },
  GciCommit: { parameters: ["pointer"], result: "i32" },
  GciAbort: { parameters: ["pointer"], result: "i32" },
  GciExecuteStr: { parameters: ["buffer", "u64"], result: "u64" },
  GciPerform: { parameters: ["u64", "buffer", "buffer", "i32"], result: "u64" },
  GciNewString: { parameters: ["buffer"], result: "u64" },
  GciNewSymbol: { parameters: ["buffer"], result: "u64" },
  GciNewOop: { parameters: ["u64"], result: "u64" },
  GciFltToOop: { parameters: ["f64"], result: "u64" },
  GciOopToFlt_: { parameters: ["u64", "buffer"], result: "i32" },
  GciFetchClass: { parameters: ["u64"], result: "u64" },
  GciFetchSize_: { parameters: ["u64"], result: "i64" },
  GciFetchBytes_: { parameters: ["u64", "i64", "buffer", "i64"], result: "i64" },
  GciResolveSymbol: { parameters: ["buffer", "u64"], result: "u64" },
  GciSymDictAt: { parameters: ["u64", "buffer", "buffer", "buffer"], result: "void" },
  GciSymDictAtPut: { parameters: ["u64", "buffer", "u64"], result: "void" },
  GciSymDictAtObjPut: { parameters: ["u64", "u64", "u64"], result: "void" },
  GciStrKeyValueDictAt: { parameters: ["u64", "buffer", "buffer"], result: "void" },
  GciStrKeyValueDictAtPut: { parameters: ["u64", "buffer", "u64"], result: "void" },
  GciGetSessionId: { parameters: [], result: "i32" },
  GciSetSessionId: { parameters: ["i32"], result: "void" },
  GciNeedsCommit: { parameters: [], result: "i32" },
  GciInTransaction: { parameters: [], result: "i32" },
  GciAddOopToExportSet: { parameters: ["u64"], result: "void", optional: true },
  GciRemoveOopFromExportSet: { parameters: ["u64"], result: "void", optional: true },
};
