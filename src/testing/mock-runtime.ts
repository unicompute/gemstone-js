import {
  OOP_FALSE,
  OOP_ILLEGAL,
  OOP_NIL,
  OOP_TRUE,
  oop,
  smallintToOop,
  type Oop,
} from "../oop.ts";
import type { GciErrorInfo, GciRuntime, LoginOptions, SymDictLookup } from "../types.ts";

export interface MockCall {
  method: string;
  args: unknown[];
}

export interface MockGciRuntimeOptions {
  execute?: (source: string, receiver: Oop) => Oop | Promise<Oop>;
  perform?: (receiver: Oop, selector: string, args: Oop[]) => Oop | Promise<Oop>;
  abortResult?: boolean;
  commitResult?: boolean;
  error?: GciErrorInfo | null;
}

export class MockGciRuntime implements GciRuntime {
  readonly name = "mock";
  readonly calls: MockCall[] = [];
  readonly symbols = new Map<string, Oop>();
  readonly strings = new Map<string, Oop>();
  readonly stringValues = new Map<Oop, string>();
  readonly classByOop = new Map<Oop, Oop>();
  readonly floats = new Map<Oop, number>();
  readonly symDict = new Map<string, Oop>();
  readonly strKeyDict = new Map<string, Oop>();
  #sessionId = 1;
  #loggedIn = false;
  #nextObject = 0x1000n;
  #lastError: GciErrorInfo | null = null;
  #execute: (source: string, receiver: Oop) => Oop | Promise<Oop>;
  #perform: (receiver: Oop, selector: string, args: Oop[]) => Oop | Promise<Oop>;
  #abortResult: boolean;
  #commitResult: boolean;

  constructor(options: MockGciRuntimeOptions = {}) {
    this.#execute = options.execute ?? defaultExecute;
    this.#perform = options.perform ?? defaultPerform;
    this.#abortResult = options.abortResult ?? true;
    this.#commitResult = options.commitResult ?? true;
    this.#lastError = options.error ?? null;
  }

  async init(_libPath?: string): Promise<number> {
    this.record("init", _libPath);
    return 1;
  }

  async encrypt(password: string): Promise<string> {
    this.record("encrypt", password);
    return `encrypted:${password}`;
  }

  async setNet(stoneName: string, hostUsername: string, encryptedHostPassword: string, gemService: string): Promise<void> {
    this.record("setNet", stoneName, hostUsername, encryptedHostPassword, gemService);
  }

  async loginEx(options: LoginOptions): Promise<number> {
    this.record("loginEx", options);
    if (!options.username || !options.password) {
      this.#lastError = { number: 401, fatal: false, message: "missing credentials" };
      return 0;
    }
    this.#loggedIn = true;
    return this.#sessionId;
  }

  async logout(_sessionId?: number): Promise<void> {
    this.record("logout", _sessionId);
    this.#loggedIn = false;
  }

  async commit(): Promise<boolean> {
    this.record("commit");
    return this.#loggedIn && this.#commitResult;
  }

  async abort(): Promise<boolean> {
    this.record("abort");
    return this.#loggedIn && this.#abortResult;
  }

  async err(): Promise<GciErrorInfo | null> {
    this.record("err");
    return this.#lastError;
  }

  async executeStr(source: string, receiver: Oop = OOP_NIL): Promise<Oop> {
    this.record("executeStr", source, receiver);
    return this.#execute(source, receiver);
  }

  async perform(receiver: Oop, selector: string, args: Oop[] = []): Promise<Oop> {
    this.record("perform", receiver, selector, args);
    return this.#perform(receiver, selector, args);
  }

  async newString(value: string): Promise<Oop> {
    this.record("newString", value);
    const existing = this.strings.get(value);
    if (existing) return existing;
    const next = this.allocate();
    this.strings.set(value, next);
    this.stringValues.set(next, value);
    this.classByOop.set(next, this.classSymbol("String"));
    return next;
  }

  async newSymbol(value: string): Promise<Oop> {
    this.record("newSymbol", value);
    const symbol = await this.resolveSymbol(value);
    this.classByOop.set(symbol, this.classSymbol("Symbol"));
    this.stringValues.set(symbol, value);
    return symbol;
  }

  async newOop(classOop: Oop): Promise<Oop> {
    this.record("newOop", classOop);
    return this.allocate();
  }

  async resolveSymbol(name: string, _symbolList: Oop = OOP_NIL): Promise<Oop> {
    this.record("resolveSymbol", name, _symbolList);
    const existing = this.symbols.get(name);
    if (existing) return existing;
    const next = this.allocate();
    this.symbols.set(name, next);
    this.stringValues.set(next, name);
    return next;
  }

  async fetchClass(value: Oop): Promise<Oop> {
    this.record("fetchClass", value);
    return this.classByOop.get(value) ?? this.classSymbol("Object");
  }

  async fetchSize(value: Oop): Promise<number> {
    this.record("fetchSize", value);
    const stringValue = this.stringValues.get(value);
    return stringValue === undefined ? 0 : new TextEncoder().encode(stringValue).byteLength;
  }

  async fetchBytes(value: Oop, start: number, count: number): Promise<Uint8Array> {
    this.record("fetchBytes", value, start, count);
    const bytes = new TextEncoder().encode(this.stringValues.get(value) ?? "");
    const offset = Math.max(start - 1, 0);
    return bytes.slice(offset, offset + count);
  }

  async getSessionId(): Promise<number> {
    this.record("getSessionId");
    return this.#loggedIn ? this.#sessionId : 0;
  }

  async setSessionId(sessionId: number): Promise<void> {
    this.record("setSessionId", sessionId);
    this.#sessionId = sessionId;
  }

  async needsCommit(): Promise<boolean> {
    this.record("needsCommit");
    return false;
  }

  async inTransaction(): Promise<boolean> {
    this.record("inTransaction");
    return this.#loggedIn;
  }

  async fltToOop(value: number): Promise<Oop> {
    this.record("fltToOop", value);
    const next = this.allocate();
    this.floats.set(next, value);
    return next;
  }

  async oopToFlt(value: Oop): Promise<number> {
    this.record("oopToFlt", value);
    const result = this.floats.get(value);
    if (result === undefined) {
      throw new Error("OOP cannot be converted to Float.");
    }
    return result;
  }

  async symDictAt(dict: Oop, key: string): Promise<SymDictLookup> {
    this.record("symDictAt", dict, key);
    const value = this.symDict.get(`${dict}:${key}`) ?? OOP_ILLEGAL;
    return { value, assoc: value === OOP_ILLEGAL ? OOP_ILLEGAL : this.allocate() };
  }

  async symDictAtPut(dict: Oop, key: string, value: Oop): Promise<void> {
    this.record("symDictAtPut", dict, key, value);
    this.symDict.set(`${dict}:${key}`, value);
  }

  async symDictAtObjPut(dict: Oop, key: Oop, value: Oop): Promise<void> {
    this.record("symDictAtObjPut", dict, key, value);
    const keyName = this.stringValues.get(key) ?? key.toString();
    this.symDict.set(`${dict}:${keyName}`, value);
  }

  async strKeyValueDictAt(dict: Oop, key: string): Promise<Oop> {
    this.record("strKeyValueDictAt", dict, key);
    return this.strKeyDict.get(`${dict}:${key}`) ?? OOP_ILLEGAL;
  }

  async strKeyValueDictAtPut(dict: Oop, key: string, value: Oop): Promise<void> {
    this.record("strKeyValueDictAtPut", dict, key, value);
    this.strKeyDict.set(`${dict}:${key}`, value);
  }

  async addOopToExportSet(value: Oop): Promise<void> {
    this.record("addOopToExportSet", value);
  }

  async removeOopFromExportSet(value: Oop): Promise<void> {
    this.record("removeOopFromExportSet", value);
  }

  record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  allocate(): Oop {
    const next = this.#nextObject;
    this.#nextObject += 8n;
    return next as Oop;
  }

  classSymbol(name: string): Oop {
    const existing = this.symbols.get(name);
    if (existing) return existing;
    const next = this.allocate();
    this.symbols.set(name, next);
    return next;
  }
}

function defaultExecute(source: string, _receiver: Oop): Oop {
  const normalized = source.replace(/\s+/g, " ").trim();
  if (normalized === "nil") return OOP_NIL;
  if (normalized === "true") return OOP_TRUE;
  if (normalized === "false") return OOP_FALSE;
  if (/^-?\d+$/.test(normalized)) return smallintToOop(BigInt(normalized));
  if (normalized === "1 + 1" || normalized === "1+1") return smallintToOop(2);
  return 0x2000n as Oop;
}

function defaultPerform(_receiver: Oop, selector: string, _args: Oop[]): Oop {
  if (selector === "yourself") return _receiver;
  if (selector === "size") return smallintToOop(0);
  return 0x3000n as Oop;
}
