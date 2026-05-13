import { Session, TypedOop } from "./client.ts";
import { OOP_NIL } from "./oop.ts";

export type ComparisonOp = "=" | "==" | "!=" | "~=" | "<" | "<=" | ">" | ">=";

export class GSCollection<T = unknown> {
  readonly session: Session;
  readonly name: string;

  constructor(session: Session, name: string) {
    this.session = session;
    this.name = name;
  }

  async createEqualityIndexOn(path: string): Promise<void> {
    await this.session.execute(`${this.name} createEqualityIndexOn: '${escapeSmalltalk(path)}'`);
  }

  async removeEqualityIndexOn(path: string): Promise<void> {
    await this.session.execute(`${this.name} removeEqualityIndexOn: '${escapeSmalltalk(path)}'`);
  }

  async search(path: string, op: ComparisonOp, value: string | number | bigint | boolean): Promise<TypedOop<T>[]> {
    const literal = await this.#literal(value);
    const source = `
      | collection results |
      collection := ${this.name}.
      results := collection select: [:each | (each ${selectorForPath(path)} ${smalltalkOp(op)} ${literal})].
      results asArray
    `;
    const result = await this.session.execute(source);
    return result === OOP_NIL ? [] : [new TypedOop<T>(this.session, result)];
  }

  async *iter(chunkSize = 256): AsyncIterable<TypedOop<T>> {
    let offset = 1;
    while (true) {
      const source = `
        | collection chunk |
        collection := ${this.name} asArray.
        chunk := collection copyFrom: ${offset} to: (${offset + chunkSize - 1} min: collection size).
        chunk isEmpty ifTrue: [nil] ifFalse: [chunk]
      `;
      const result = await this.session.execute(source);
      if (result === OOP_NIL) return;
      yield new TypedOop<T>(this.session, result);
      offset += chunkSize;
    }
  }

  async #literal(value: string | number | bigint | boolean): Promise<string> {
    if (typeof value === "string") return `'${escapeSmalltalk(value)}'`;
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number" || typeof value === "bigint") return value.toString();
    throw new TypeError(`Unsupported query literal: ${String(value)}`);
  }
}

function selectorForPath(path: string): string {
  return path.split(".").map((part) => part.trim()).filter(Boolean).join(" ");
}

function smalltalkOp(op: ComparisonOp): string {
  if (op === "==" || op === "=") return "=";
  if (op === "!=") return "~=";
  return op;
}

function escapeSmalltalk(value: string): string {
  return value.replaceAll("'", "''");
}
