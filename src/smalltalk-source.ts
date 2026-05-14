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

export function objectForOopSource(value: bigint): string {
  return `Object _objectForOop: ${value.toString()}`;
}

export function escapedFieldEncoderSource(varName = "encode"): string {
  return String.raw`${varName} := [:value | | text |
  text := value isNil ifTrue: [''] ifFalse: [value asString].
  text := text copyReplaceAll: '\' with: '\\'.
  text := text copyReplaceAll: String cr with: '\r'.
  text := text copyReplaceAll: String lf with: '\n'.
  text := text copyReplaceAll: '|' with: '\p'.
  text
].
`;
}

export function decodeEscapedField(value: string): string {
  if (!value.includes("\\")) return value;

  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }

    index += 1;
    if (index >= value.length) {
      decoded += "\\";
      break;
    }

    const escaped = value[index];
    if (escaped === "n") decoded += "\n";
    else if (escaped === "r") decoded += "\r";
    else if (escaped === "p") decoded += "|";
    else if (escaped === "\\") decoded += "\\";
    else decoded += `\\${escaped}`;
  }
  return decoded;
}
