import { oop, type Oop } from "../oop.ts";
import type { GciErrorInfo } from "../types.ts";

const encoder = new TextEncoder();
const GCI_ERR_STR_SIZE = 1024;
const GCI_MAX_ERR_ARGS = 10;
const GCI_ERR_CATEGORY_OFFSET = 0;
const GCI_ERR_CONTEXT_OFFSET = 8;
const GCI_ERR_EXCEPTION_OFFSET = 16;
const GCI_ERR_ARGS_OFFSET = 24;
const GCI_ERR_NUMBER_OFFSET = GCI_ERR_ARGS_OFFSET + GCI_MAX_ERR_ARGS * 8;
const GCI_ERR_ARG_COUNT_OFFSET = GCI_ERR_NUMBER_OFFSET + 4;
const GCI_ERR_FATAL_OFFSET = GCI_ERR_ARG_COUNT_OFFSET + 4;
const GCI_ERR_MESSAGE_OFFSET = GCI_ERR_FATAL_OFFSET + 1;
const GCI_ERR_REASON_OFFSET = GCI_ERR_MESSAGE_OFFSET + GCI_ERR_STR_SIZE + 1;
const GCI_ERR_BUFFER_SIZE = alignTo(GCI_ERR_REASON_OFFSET + GCI_ERR_STR_SIZE + 1, 8);

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

export function gciErrorBuffer(): Uint8Array {
  return new Uint8Array(GCI_ERR_BUFFER_SIZE);
}

export function decodeGciErrorInfo(buffer: Uint8Array, ok: unknown): GciErrorInfo | null {
  if (buffer.byteLength < GCI_ERR_REASON_OFFSET + GCI_ERR_STR_SIZE + 1) {
    throw new RangeError("GciErr buffer is too small.");
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const number = view.getInt32(GCI_ERR_NUMBER_OFFSET, true);
  if (Number(ok) === 0 && number === 0) return null;

  const argCount = Math.max(0, Math.min(view.getInt32(GCI_ERR_ARG_COUNT_OFFSET, true), GCI_MAX_ERR_ARGS));
  const args: Oop[] = [];
  for (let index = 0; index < argCount; index += 1) {
    args.push(oopFrom(view.getBigUint64(GCI_ERR_ARGS_OFFSET + index * 8, true)));
  }
  const reason = readCString(buffer.subarray(GCI_ERR_REASON_OFFSET, GCI_ERR_REASON_OFFSET + GCI_ERR_STR_SIZE + 1));
  return {
    category: oopFrom(view.getBigUint64(GCI_ERR_CATEGORY_OFFSET, true)),
    context: oopFrom(view.getBigUint64(GCI_ERR_CONTEXT_OFFSET, true)),
    exceptionObj: oopFrom(view.getBigUint64(GCI_ERR_EXCEPTION_OFFSET, true)),
    args,
    number,
    fatal: buffer[GCI_ERR_FATAL_OFFSET] !== 0,
    message: readCString(buffer.subarray(GCI_ERR_MESSAGE_OFFSET, GCI_ERR_MESSAGE_OFFSET + GCI_ERR_STR_SIZE + 1)),
    ...(reason ? { reason } : {}),
  };
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

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}
