declare module "@gemstone-js/native" {
  export interface LoginOptions {
    username: string;
    password: string;
    flags?: number;
    haltOnError?: boolean;
  }

  export interface GciErrorInfo {
    number: number;
    fatal: boolean;
    message: string;
    reason?: string;
    category: string;
    context: string;
    exceptionObj: string;
    args: string[];
  }

  export interface GemStoneNativeError extends Error {
    code: "GEMSTONE_GCI_ERROR";
    operation: string;
    nativeCode?: string;
    gciNumber?: number;
    fatal?: boolean;
    gciMessage?: string;
    reason?: string;
    category?: string;
    context?: string;
    exceptionObj?: string;
    args?: string[];
    info?: GciErrorInfo;
  }

  export interface SymDictLookup {
    value: string;
    assoc: string;
  }

  export function isGemStoneNativeError(error: unknown): error is GemStoneNativeError;
  export function smallintToOop(value: number): string;
  export function oopToSmallint(value: string): number;
  export function isSmallintOop(value: string): boolean;
  export function boolToOop(value: boolean): string;
  export function charToOopString(value: string): string;
  export function oopToCharString(value: string): string | null;

  export class Gci {
    constructor(libPath?: string);
    init(libPath?: string): number;
    libraryPath(): string;
    encrypt(password: string): string;
    setNet(stoneName: string, hostUsername: string, encryptedHostPassword: string, gemService: string): void;
    loginEx(options: LoginOptions): number;
    logout(): number;
    commit(): boolean;
    abort(): boolean;
    err(): GciErrorInfo | null;
    executeStr(source: string, receiver?: string): string;
    perform(receiver: string, selector: string, args?: string[]): string;
    newString(value: string): string;
    newSymbol(value: string): string;
    newOop(classOop: string): string;
    resolveSymbol(name: string, symbolList?: string): string;
    fetchClass(oop: string): string;
    fetchSize(oop: string): number;
    fetchBytes(oop: string, start: number, count: number): Uint8Array;
    getSessionId(): number;
    setSessionId(sessionId: number): void;
    needsCommit(): boolean;
    inTransaction(): boolean;
    fltToOop(value: number): string;
    oopToFlt(oop: string): number;
    symDictAt(dict: string, key: string): SymDictLookup;
    symDictAtPut(dict: string, key: string, value: string): void;
    symDictAtObjPut(dict: string, key: string, value: string): void;
    strKeyValueDictAt(dict: string, key: string): string;
    strKeyValueDictAtPut(dict: string, key: string, value: string): void;
    addOopToExportSet(oop: string): void;
    removeOopFromExportSet(oop: string): void;
  }

  export class GciSessionWorker {
    constructor(libPath?: string | null);
    call(method: string, ...args: unknown[]): Promise<unknown>;
    close(): Promise<void>;
    init(libPath?: string): Promise<number>;
    libraryPath(): Promise<string>;
    encrypt(password: string): Promise<string>;
    setNet(stoneName: string, hostUsername: string, encryptedHostPassword: string, gemService: string): Promise<void>;
    loginEx(options: LoginOptions): Promise<number>;
    logout(): Promise<number>;
    commit(): Promise<boolean>;
    abort(): Promise<boolean>;
    err(): Promise<GciErrorInfo | null>;
    executeStr(source: string, receiver?: string): Promise<string>;
    perform(receiver: string, selector: string, args?: string[]): Promise<string>;
    newString(value: string): Promise<string>;
    newSymbol(value: string): Promise<string>;
    newOop(classOop: string): Promise<string>;
    resolveSymbol(name: string, symbolList?: string): Promise<string>;
    fetchClass(oop: string): Promise<string>;
    fetchSize(oop: string): Promise<number>;
    fetchBytes(oop: string, start: number, count: number): Promise<Uint8Array>;
    getSessionId(): Promise<number>;
    setSessionId(sessionId: number): Promise<void>;
    needsCommit(): Promise<boolean>;
    inTransaction(): Promise<boolean>;
    fltToOop(value: number): Promise<string>;
    oopToFlt(oop: string): Promise<number>;
    symDictAt(dict: string, key: string): Promise<SymDictLookup>;
    symDictAtPut(dict: string, key: string, value: string): Promise<void>;
    symDictAtObjPut(dict: string, key: string, value: string): Promise<void>;
    strKeyValueDictAt(dict: string, key: string): Promise<string>;
    strKeyValueDictAtPut(dict: string, key: string, value: string): Promise<void>;
    addOopToExportSet(oop: string): Promise<void>;
    removeOopFromExportSet(oop: string): Promise<void>;
  }

  export function createGciSessionWorker(libPath?: string | null): GciSessionWorker;
}
