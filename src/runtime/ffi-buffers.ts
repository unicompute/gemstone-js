import { oop, type Oop } from "../oop.ts";

const encoder = new TextEncoder();

export function cString(value: string): Uint8Array {
  const bytes = encoder.encode(value);
  const out = new Uint8Array(bytes.byteLength + 1);
  out.set(bytes);
  return out;
}

export function readCString(value: Uint8Array): string {
  const end = value.indexOf(0);
  return new TextDecoder().decode(end === -1 ? value : value.subarray(0, end));
}

export function oopArray(values: readonly Oop[]): BigUint64Array {
  const out = new BigUint64Array(values.length);
  values.forEach((value, index) => {
    out[index] = BigInt.asUintN(64, value);
  });
  return out;
}

export function outOop(): BigUint64Array {
  return new BigUint64Array(1);
}

export function oopFrom(value: unknown): Oop {
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "string") {
    return oop(value);
  }
  throw new TypeError(`Expected OOP-compatible bigint, number, or string; got ${typeof value}.`);
}

export function validateFetchStart(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("fetchBytes start must be a positive safe integer.");
  }
  return value;
}

export function validateFetchCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("fetchBytes count must be a non-negative safe integer.");
  }
  return value;
}
