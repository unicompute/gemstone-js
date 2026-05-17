import { oop, type Oop } from "./oop.ts";
import type {
  GemStoneClassDescription,
  GemStoneDumpOptions,
  GemStoneInspection,
  GemStoneObjectDump,
} from "./types.ts";

export interface InspectCliSession {
  inspect(value: Oop): Promise<GemStoneInspection>;
  dump(value: Oop, options?: GemStoneDumpOptions): Promise<GemStoneObjectDump>;
  describeClass(name: string): Promise<GemStoneClassDescription>;
  logout(): Promise<void>;
}

export interface InspectCliIo {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  connect(): Promise<InspectCliSession>;
}

export type InspectCliOptions =
  | { help: true }
  | {
      help: false;
      target: "oop";
      oop: Oop;
      dump: boolean;
      depth: number;
      includeIndexedFields: boolean;
      json: boolean;
    }
  | {
      help: false;
      target: "class";
      className: string;
      json: boolean;
    };

export class InspectCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectCliUsageError";
  }
}

export async function runInspectCli(argv: readonly string[], io: InspectCliIo): Promise<number> {
  let options: InspectCliOptions;
  try {
    options = parseInspectCliArgs(argv);
  } catch (error) {
    io.stderr.write(`${errorMessage(error)}\n\n${inspectCliUsage()}`);
    return 2;
  }

  if (options.help) {
    io.stdout.write(inspectCliUsage());
    return 0;
  }

  let session: InspectCliSession | undefined;
  try {
    session = await io.connect();
    if (options.target === "class") {
      const description = await session.describeClass(options.className);
      io.stdout.write(options.json ? jsonOutput(description) : formatClassDescription(description));
      return 0;
    }

    if (options.dump) {
      const payload = await session.dump(options.oop, {
        depth: options.depth,
        includeIndexedFields: options.includeIndexedFields,
      });
      io.stdout.write(jsonOutput(payload));
      return 0;
    }

    const inspection = await session.inspect(options.oop);
    io.stdout.write(options.json ? jsonOutput(inspection) : formatInspection(inspection));
    return 0;
  } catch (error) {
    io.stderr.write(`gemstone-js-inspect: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    if (session) {
      try {
        await session.logout();
      } catch {
        // Keep the primary command result visible.
      }
    }
  }
}

export function parseInspectCliArgs(argv: readonly string[]): InspectCliOptions {
  let target: "oop" | "class" | undefined;
  let rawOop: Oop | undefined;
  let className: string | undefined;
  let dump = false;
  let depth = 2;
  let includeIndexedFields = true;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "--oop") {
      ensureNoTarget(target);
      target = "oop";
      rawOop = parseOopArgument(readOptionValue(argv, index, "--oop"));
      index += 1;
    } else if (arg === "--class") {
      ensureNoTarget(target);
      target = "class";
      className = readOptionValue(argv, index, "--class");
      if (!className) throw new InspectCliUsageError("--class requires a non-empty class name.");
      index += 1;
    } else if (arg === "--dump") {
      dump = true;
    } else if (arg === "--depth") {
      depth = parseDepthArgument(readOptionValue(argv, index, "--depth"));
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--no-indexed-fields") {
      includeIndexedFields = false;
    } else if (arg === "--indexed-fields") {
      includeIndexedFields = true;
    } else {
      throw new InspectCliUsageError(`Unexpected argument: ${arg}`);
    }
  }

  if (!target) {
    throw new InspectCliUsageError("Missing target: pass --oop <oop> or --class <name>.");
  }
  if (target === "class") {
    if (dump) throw new InspectCliUsageError("--dump can only be used with --oop.");
    if (!className) throw new InspectCliUsageError("--class requires a class name.");
    return { help: false, target, className, json };
  }
  if (!rawOop) throw new InspectCliUsageError("--oop requires an OOP value.");
  return { help: false, target, oop: rawOop, dump, depth, includeIndexedFields, json };
}

export function inspectCliUsage(): string {
  return [
    "Usage:",
    "  gemstone-js-inspect --oop <oop> [--json]",
    "  gemstone-js-inspect --oop <oop> --dump [--depth <n>] [--no-indexed-fields]",
    "  gemstone-js-inspect --class <name> [--json]",
    "",
    "Connection settings are read from GS_USERNAME/GS_USER, GS_PASSWORD/GS_PASS,",
    "GS_STONE, GS_NETLDI/GS_NETLDI_NAME_OR_PORT, GS_HOST/GS_NETLDI_HOST,",
    "GS_GEM_SERVICE/GS_SERVICE, GS_HOST_USERNAME, GS_HOST_PASSWORD, and GS_LIB_PATH.",
    "",
  ].join("\n");
}

export function formatInspection(inspection: GemStoneInspection): string {
  const lines = [
    `OOP: ${inspection.oop.toString()}`,
    `Class: ${inspection.class}`,
    `Print: ${inspection.printString}`,
  ];
  if (inspection.classOop) lines.push(`Class OOP: ${inspection.classOop.toString()}`);
  if (inspection.size !== undefined) lines.push(`Size: ${inspection.size}`);
  if (inspection.byteSize !== undefined) lines.push(`Byte Size: ${inspection.byteSize}`);
  if (inspection.classHierarchy?.length) lines.push(`Hierarchy: ${inspection.classHierarchy.join(" > ")}`);
  if (inspection.slots?.length) {
    lines.push("Slots:");
    for (const slot of inspection.slots) lines.push(`  ${slot.name}: ${formatReference(slot)}`);
  }
  if (inspection.indexedFields?.length) {
    lines.push("Indexed Fields:");
    for (const field of inspection.indexedFields) lines.push(`  ${field.index}: ${formatReference(field)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatClassDescription(description: GemStoneClassDescription): string {
  const lines = [`Class: ${description.name}`];
  if (description.oop) lines.push(`OOP: ${description.oop.toString()}`);
  if (description.instanceCount !== undefined) lines.push(`Instance Count: ${description.instanceCount}`);
  if (description.superclasses.length) lines.push(`Superclasses: ${description.superclasses.join(" > ")}`);
  if (description.instVarNames.length) {
    lines.push("Instance Variables:");
    for (const name of description.instVarNames) lines.push(`  ${name}`);
  }
  if (description.classInstVarNames.length) {
    lines.push("Class Instance Variables:");
    for (const name of description.classInstVarNames) lines.push(`  ${name}`);
  }
  return `${lines.join("\n")}\n`;
}

export function jsonOutput(value: unknown): string {
  return `${JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2)}\n`;
}

function readOptionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new InspectCliUsageError(`${option} requires a value.`);
  }
  return value;
}

function ensureNoTarget(target: "oop" | "class" | undefined): void {
  if (target) throw new InspectCliUsageError("Pass only one target: --oop or --class.");
}

function parseOopArgument(value: string): Oop {
  if (!/^(?:0x[0-9a-fA-F]+|\d+)$/.test(value)) {
    throw new InspectCliUsageError(`Invalid OOP value: ${value}`);
  }
  return oop(value);
}

function parseDepthArgument(value: string): number {
  if (!/^\d+$/.test(value)) throw new InspectCliUsageError("--depth must be a non-negative integer.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new InspectCliUsageError("--depth is outside JavaScript's safe integer range.");
  return parsed;
}

function formatReference(value: { value: string; oop?: Oop; class?: string }): string {
  const metadata = [];
  if (value.class) metadata.push(value.class);
  if (value.oop) metadata.push(`oop=${value.oop.toString()}`);
  return metadata.length ? `${value.value} [${metadata.join(" ")}]` : value.value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
