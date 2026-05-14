import type { MarshalledValue, Session } from "./client.ts";
import { escapeSmalltalkStringLiteral, validateGemStoneGlobalName } from "./smalltalk-source.ts";

export const BOOTSTRAP_VERSION = "1";
export const BOOTSTRAP_MARKER_KEY = "GemstoneJsBootstrapVersion";

export interface BootstrapArtifact {
  name: string;
  description: string;
  expectedClass: string;
  userGlobalsKey?: string;
  statusExpression?: string;
}

export interface BootstrapArtifactStatus {
  artifact: BootstrapArtifact;
  present: boolean;
}

export interface BootstrapOptions {
  dryRun?: boolean;
  commit?: boolean;
}

export interface BootstrapResult {
  version: string;
  applied: boolean;
  message: string;
  createdKeys: string[];
  before: BootstrapArtifactStatus[];
  after: BootstrapArtifactStatus[];
  source: string;
}

export interface BootstrapCliSession {
  eval(source: string): Promise<MarshalledValue>;
  commit(): Promise<void>;
  abort(): Promise<void>;
  logout(): Promise<void>;
}

export interface BootstrapCliIo {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  connect(): Promise<BootstrapCliSession>;
}

interface BootstrapCliOptions {
  help: boolean;
  status: boolean;
  dryRun: boolean;
  printSource: boolean;
}

export class BootstrapCliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapCliUsageError";
  }
}

export const BOOTSTRAP_ARTIFACTS: readonly BootstrapArtifact[] = [
  {
    name: BOOTSTRAP_MARKER_KEY,
    description: "Version marker written by the gemstone-js bootstrap script.",
    expectedClass: "String",
    userGlobalsKey: BOOTSTRAP_MARKER_KEY,
  },
  {
    name: "GStoreRoot",
    description: "Root dictionary for GStore named key/value stores.",
    expectedClass: "StringKeyValueDictionary",
    userGlobalsKey: "GStoreRoot",
  },
  {
    name: "GSQueryRoot",
    description: "Root dictionary reserved for GSCollection named query stores.",
    expectedClass: "Dictionary",
    userGlobalsKey: "GSQueryRoot",
  },
  {
    name: "ObjectLogEntry objectLog",
    description: "GemStone built-in ObjectLog used by ObjectLog helpers.",
    expectedClass: "ObjectLog",
    statusExpression: "ObjectLogEntry objectLog notNil",
  },
];

export function bootstrapSource(): string {
  return [
    "| created version |",
    "created := OrderedCollection new.",
    `version := '${escapeSmalltalkStringLiteral(BOOTSTRAP_VERSION)}'.`,
    "",
    "(UserGlobals includesKey: #GStoreRoot) ifFalse: [",
    "  UserGlobals at: #GStoreRoot put: StringKeyValueDictionary new.",
    "  created add: 'GStoreRoot'",
    "].",
    "",
    "(UserGlobals includesKey: #GSQueryRoot) ifFalse: [",
    "  UserGlobals at: #GSQueryRoot put: Dictionary new.",
    "  created add: 'GSQueryRoot'",
    "].",
    "",
    `(UserGlobals includesKey: #${BOOTSTRAP_MARKER_KEY}) ifFalse: [`,
    `  created add: '${BOOTSTRAP_MARKER_KEY}'`,
    "].",
    `UserGlobals at: #${BOOTSTRAP_MARKER_KEY} put: version.`,
    "",
    `'gemstone-js bootstrap ', version, ' created: ', created asArray printString`,
    "",
  ].join("\n");
}

export async function auditBootstrap(session: Pick<Session, "eval">): Promise<BootstrapArtifactStatus[]> {
  const result: BootstrapArtifactStatus[] = [];
  for (const artifact of BOOTSTRAP_ARTIFACTS) {
    result.push({ artifact, present: await artifactPresent(session, artifact) });
  }
  return result;
}

export async function bootstrapGemStone(
  session: Pick<Session, "eval" | "commit">,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const source = bootstrapSource();
  const before = await auditBootstrap(session);
  if (options.dryRun) {
    return {
      version: BOOTSTRAP_VERSION,
      applied: false,
      message: "dry run: bootstrap source was not evaluated",
      createdKeys: [],
      before,
      after: before,
      source,
    };
  }

  const message = String(await session.eval(source));
  if (options.commit) await session.commit();
  const after = await auditBootstrap(session);
  const createdKeys = createdUserGlobalsKeys(before, after);
  return {
    version: BOOTSTRAP_VERSION,
    applied: createdKeys.length > 0,
    message,
    createdKeys,
    before,
    after,
    source,
  };
}

export function formatBootstrapPlan(): string {
  const lines = ["Artifacts:"];
  for (const artifact of BOOTSTRAP_ARTIFACTS) {
    lines.push(`  - ${artifactLocation(artifact)} (${artifact.expectedClass}): ${artifact.description}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatBootstrapStatuses(statuses: readonly BootstrapArtifactStatus[]): string {
  const lines = ["GemStone-side gemstone-js artifact status:"];
  for (const status of statuses) {
    lines.push(`  - ${status.present ? "present" : "missing"}: ${artifactLocation(status.artifact)} (${status.artifact.expectedClass})`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatBootstrapResult(result: BootstrapResult): string {
  const lines = [result.message];
  if (result.createdKeys.length) {
    lines.push(`Created UserGlobals keys: ${result.createdKeys.join(", ")}`);
  } else {
    lines.push("No UserGlobals keys were missing.");
  }
  lines.push("", formatBootstrapStatuses(result.after).trimEnd());
  return `${lines.join("\n")}\n`;
}

export async function runBootstrapCli(argv: readonly string[], io: BootstrapCliIo): Promise<number> {
  let options: BootstrapCliOptions;
  try {
    options = parseBootstrapCliArgs(argv);
  } catch (error) {
    io.stderr.write(`${errorMessage(error)}\n\n${bootstrapCliUsage()}`);
    return 2;
  }

  if (options.help) {
    io.stdout.write(bootstrapCliUsage());
    return 0;
  }
  if (options.printSource) {
    io.stdout.write(bootstrapSource());
    return 0;
  }
  if (options.dryRun) {
    io.stdout.write([
      "gemstone-js GemStone-side bootstrap dry run",
      "",
      formatBootstrapPlan().trimEnd(),
      "",
      bootstrapSource().trimEnd(),
      "",
    ].join("\n"));
    return 0;
  }

  let session: BootstrapCliSession | undefined;
  try {
    session = await io.connect();
    if (options.status) {
      io.stdout.write(formatBootstrapStatuses(await auditBootstrap(session)));
      await session.abort();
      return 0;
    }
    io.stdout.write(formatBootstrapResult(await bootstrapGemStone(session, { commit: true })));
    return 0;
  } catch (error) {
    if (session) await session.abort().catch(() => undefined);
    io.stderr.write(`gemstone-js-bootstrap: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    if (session) await session.logout().catch(() => undefined);
  }
}

export function bootstrapCliUsage(): string {
  return [
    "Usage: gemstone-js-bootstrap [--status | --dry-run | --print-source]",
    "",
    "Connection settings are read from GS_USERNAME, GS_PASSWORD, GS_STONE,",
    "GS_NETLDI, GS_HOST, GS_GEM_SERVICE, GS_HOST_USERNAME, GS_HOST_PASSWORD,",
    "and GS_LIB_PATH.",
    "",
  ].join("\n");
}

function parseBootstrapCliArgs(argv: readonly string[]): BootstrapCliOptions {
  const options: BootstrapCliOptions = {
    help: false,
    status: false,
    dryRun: false,
    printSource: false,
  };
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--status") options.status = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--print-source") options.printSource = true;
    else throw new BootstrapCliUsageError(`Unexpected argument: ${arg}`);
  }
  const selected = [options.status, options.dryRun, options.printSource].filter(Boolean).length;
  if (selected > 1) throw new BootstrapCliUsageError("Pass only one action: --status, --dry-run, or --print-source.");
  return options;
}

async function artifactPresent(session: Pick<Session, "eval">, artifact: BootstrapArtifact): Promise<boolean> {
  if (artifact.userGlobalsKey) {
    return Boolean(await session.eval(userGlobalsContainsSource(artifact.userGlobalsKey)));
  }
  if (artifact.statusExpression) {
    return Boolean(await session.eval(artifact.statusExpression));
  }
  return false;
}

function userGlobalsContainsSource(key: string): string {
  return `UserGlobals includesKey: ${smalltalkSymbol(key)}`;
}

function smalltalkSymbol(name: string): string {
  return `#${validateGemStoneGlobalName(name, "bootstrap artifact name")}`;
}

function artifactLocation(artifact: BootstrapArtifact): string {
  return artifact.userGlobalsKey ? `UserGlobals at: ${smalltalkSymbol(artifact.userGlobalsKey)}` : artifact.name;
}

function createdUserGlobalsKeys(
  before: readonly BootstrapArtifactStatus[],
  after: readonly BootstrapArtifactStatus[],
): string[] {
  const beforeByName = new Map(before.map((status) => [status.artifact.name, status]));
  const created: string[] = [];
  for (const status of after) {
    const key = status.artifact.userGlobalsKey;
    if (!key || !status.present) continue;
    if (beforeByName.get(status.artifact.name)?.present === false) created.push(key);
  }
  return created;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
