export type Oop = bigint & { readonly __brand: "Oop" };

export const OOP_ILLEGAL = 0x01n as Oop;
export const OOP_NIL = 0x14n as Oop;
export const OOP_FALSE = 0x0Cn as Oop;
export const OOP_TRUE = 0x10Cn as Oop;
export const OOP_ASCII_NUL = 0x1Cn as Oop;

const TAG_SMALLINT = 0x2n;
const TAG_SMALLDOUBLE = 0x6n;
const TAG_SPECIAL = 0x4n;
const SMALLINT_SHIFT = 3n;
const CHAR_TAG_BYTE = 0x1Cn;

export function oop(value: bigint | number | string): Oop {
  return BigInt(value) as Oop;
}

export function rawOop(value: Oop): bigint {
  return value;
}

export function oopToHex(value: Oop): string {
  return `0x${BigInt.asUintN(64, value).toString(16).padStart(16, "0")}`;
}

export function isIllegal(value: Oop): boolean {
  return value === OOP_ILLEGAL;
}

export function isNil(value: Oop): boolean {
  return value === OOP_NIL;
}

export function isBoolean(value: Oop): boolean {
  return value === OOP_TRUE || value === OOP_FALSE;
}

export function boolToOop(value: boolean): Oop {
  return value ? OOP_TRUE : OOP_FALSE;
}

export function oopToBool(value: Oop): boolean | undefined {
  if (value === OOP_TRUE) return true;
  if (value === OOP_FALSE) return false;
  return undefined;
}

export function isSmallint(value: Oop): boolean {
  return (value & 0x7n) === TAG_SMALLINT;
}

export function isSmalldouble(value: Oop): boolean {
  return (value & 0x7n) === TAG_SMALLDOUBLE;
}

export function smallintToOop(value: bigint | number): Oop {
  const signed = typeof value === "bigint" ? value : BigInt(value);
  return BigInt.asUintN(64, (signed << SMALLINT_SHIFT) | TAG_SMALLINT) as Oop;
}

export function oopToSmallint(value: Oop): bigint {
  return BigInt.asIntN(64, value) >> SMALLINT_SHIFT;
}

export function isChar(value: Oop): boolean {
  return (value & 0xFFn) === CHAR_TAG_BYTE && (value & 0x6n) === TAG_SPECIAL;
}

export function charToOop(value: string): Oop {
  const chars = Array.from(value);
  if (chars.length !== 1) {
    throw new RangeError("GemStone Character OOP requires exactly one Unicode scalar value.");
  }
  const codePoint = chars[0].codePointAt(0);
  if (codePoint === undefined || codePoint > 0x1F_FFFF) {
    throw new RangeError(`Invalid GemStone Character code point: ${codePoint}`);
  }
  return ((BigInt(codePoint) << 8n) | CHAR_TAG_BYTE) as Oop;
}

export function oopToChar(value: Oop): string {
  if (!isChar(value)) {
    throw new RangeError(`OOP ${oopToHex(value)} is not a GemStone Character.`);
  }
  const codePoint = Number((value >> 8n) & 0x1F_FFFFn);
  return String.fromCodePoint(codePoint);
}

export function marshalImmediateOop(value: Oop): bigint | boolean | string | null | Oop {
  if (isNil(value)) return null;
  const bool = oopToBool(value);
  if (bool !== undefined) return bool;
  if (isSmallint(value)) return oopToSmallint(value);
  if (isChar(value)) return oopToChar(value);
  return value;
}

export function valueToImmediateOop(value: bigint | number | boolean | string | null): Oop {
  if (typeof value === "bigint") return smallintToOop(value);
  if (typeof value === "number" && Number.isInteger(value)) return smallintToOop(value);
  if (typeof value === "boolean") return boolToOop(value);
  if (value === null) return OOP_NIL;
  if (typeof value === "string" && Array.from(value).length === 1) return charToOop(value);
  if (typeof value === "string") {
    throw new TypeError("Use Session.newString() for GemStone String objects.");
  }
  throw new TypeError(`Unsupported immediate GemStone value: ${String(value)}`);
}
