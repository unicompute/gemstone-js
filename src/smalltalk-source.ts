const GEMSTONE_GLOBAL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateGemStoneGlobalName(value: string, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`GemStone ${field} must be a string.`);
  }
  if (!GEMSTONE_GLOBAL_PATTERN.test(value)) {
    throw new RangeError(`GemStone ${field} must be a simple global name: ${value}`);
  }
  return value;
}

export function escapeSmalltalkStringLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
