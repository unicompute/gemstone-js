import { readdirSync } from "node:fs";
import { Session } from "./client.ts";
import { resolveGciLibraryPath, type GciLibraryDiscoveryEnv, type GciLibraryDiscoveryHost } from "./runtime/library-discovery.ts";
import { sessionConfigFromEnv, sessionEnvAliasConflicts, type SessionEnv } from "./session-env.ts";
import type { SessionConfig } from "./types.ts";

type MaybePromise<T> = T | Promise<T>;

const REQUIRED_NATIVE_SESSION_WORKER_METHODS = [
  "init",
  "encrypt",
  "setNet",
  "loginEx",
  "logout",
  "commit",
  "abort",
  "err",
  "executeStr",
  "perform",
  "newString",
  "newSymbol",
  "newOop",
  "resolveSymbol",
  "fetchClass",
  "fetchSize",
  "fetchBytes",
  "getSessionId",
  "setSessionId",
  "needsCommit",
  "inTransaction",
  "fltToOop",
  "oopToFlt",
  "symDictAt",
  "symDictAtPut",
  "symDictAtObjPut",
  "strKeyValueDictAt",
  "strKeyValueDictAtPut",
  "addOopToExportSet",
  "removeOopFromExportSet",
  "close",
] as const;

export type DoctorStatus = "ok" | "warning" | "error";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorConfigReport {
  stone: string;
  netldi: string;
  host: string;
  usernameSet: boolean;
  passwordSet: boolean;
  hostUsernameSet: boolean;
  hostPasswordSet: boolean;
  gemService: string;
  nativeSessionWorker: boolean;
  libPath?: string;
}

export interface DoctorReport {
  status: DoctorStatus;
  runtime: string;
  live: boolean;
  config: DoctorConfigReport;
  checks: DoctorCheck[];
}

export interface DoctorSession {
  eval(source: string): Promise<unknown>;
  logout(): Promise<void>;
}

export interface DoctorOptions {
  env?: GciLibraryDiscoveryEnv & Record<string, string | undefined>;
  live?: boolean;
  native?: boolean;
  nativeProbe?: (options: { nativeSessionWorker: boolean }) => MaybePromise<DoctorCheck>;
  connect?: (config: SessionConfig) => Promise<DoctorSession>;
  libraryHost?: GciLibraryDiscoveryHost;
}

export interface DoctorCliIo {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  env?: GciLibraryDiscoveryEnv & Record<string, string | undefined>;
  nativeProbe?: (options: { nativeSessionWorker: boolean }) => MaybePromise<DoctorCheck>;
  connect?: (config: SessionConfig) => Promise<DoctorSession>;
}

interface DoctorCliOptions {
  help: boolean;
  json: boolean;
  live: boolean;
  native: boolean;
}

export async function buildDoctorReport(options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? defaultEnv();
  const config = sessionConfigFromEnv(env);
  const checks: DoctorCheck[] = [
    runtimeCheck(),
    credentialsCheck(config, options.live === true),
    ...environmentAliasConflictChecks(env),
    libraryCheck(config, env, options.libraryHost ?? defaultLibraryHost()),
  ];

  if (options.native !== false) {
    checks.push(await (options.nativeProbe ?? defaultNativeProbe)({
      nativeSessionWorker: config.nativeSessionWorker === true,
    }));
  }
  if (options.live) {
    checks.push(await liveCheck(config, options.connect ?? ((sessionConfig) => Session.connect(sessionConfig))));
  }

  return {
    status: summarizeStatus(checks),
    runtime: runtimeName(),
    live: options.live === true,
    config: reportConfig(config),
    checks,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    `gemstone-js doctor: ${report.status}`,
    `runtime: ${report.runtime}`,
    `target: ${report.config.stone}@${report.config.host} netldi=${report.config.netldi} gemService=${report.config.gemService}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase()} ${check.name}: ${check.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runDoctorCli(argv: readonly string[], io: DoctorCliIo): Promise<number> {
  let options: DoctorCliOptions;
  try {
    options = parseDoctorArgs(argv);
  } catch (error) {
    io.stderr.write(`${errorMessage(error)}\n\n${doctorUsage()}`);
    return 2;
  }

  if (options.help) {
    io.stdout.write(doctorUsage());
    return 0;
  }

  const report = await buildDoctorReport({
    env: io.env,
    live: options.live,
    native: options.native,
    nativeProbe: io.nativeProbe,
    connect: io.connect,
  });
  io.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctorReport(report));
  return report.status === "error" ? 1 : 0;
}

export function doctorUsage(): string {
  return `Usage: gemstone-js-doctor [options]

Options:
  --json        Print a machine-readable doctor report
  --live        Attempt a live GemStone login and simple eval
  --no-native   Skip the optional @gemstone-js/native availability check
  -h, --help    Show this help
`;
}

function parseDoctorArgs(args: readonly string[]): DoctorCliOptions {
  const options: DoctorCliOptions = {
    help: false,
    json: false,
    live: false,
    native: true,
  };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--live") options.live = true;
    else if (arg === "--no-native") options.native = false;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return options;
}

function runtimeCheck(): DoctorCheck {
  const name = runtimeName();
  if (name === "unknown") {
    return {
      name: "runtime",
      status: "error",
      message: "unsupported JavaScript runtime",
    };
  }
  return {
    name: "runtime",
    status: "ok",
    message: `${name} runtime detected`,
  };
}

function credentialsCheck(config: SessionConfig, live: boolean): DoctorCheck {
  const missing = [];
  if (!config.username) missing.push("GS_USERNAME/GS_USER");
  if (!config.password) missing.push("GS_PASSWORD/GS_PASS");
  if (missing.length === 0) {
    return {
      name: "credentials",
      status: "ok",
      message: "GemStone username and password are configured",
    };
  }
  return {
    name: "credentials",
    status: live ? "error" : "warning",
    message: `missing ${missing.join(" and ")}${live ? "; live checks cannot run" : ""}`,
  };
}

function environmentAliasConflictChecks(env: SessionEnv): DoctorCheck[] {
  const conflicts = sessionEnvAliasConflicts(env);
  if (conflicts.length === 0) return [];
  return [{
    name: "environment-aliases",
    status: "warning",
    message: `conflicting environment aliases: ${conflicts.map(({ canonical, alias }) => `${canonical}/${alias}`).join(", ")}; canonical values win`,
    details: { conflicts },
  }];
}

function libraryCheck(
  config: SessionConfig,
  env: GciLibraryDiscoveryEnv,
  host: GciLibraryDiscoveryHost,
): DoctorCheck {
  const resolved = resolveGciLibraryPath(config.libPath, env, host);
  if (resolved) {
    return {
      name: "gci-library",
      status: "ok",
      message: `resolved ${resolved}`,
      details: { path: resolved },
    };
  }
  return {
    name: "gci-library",
    status: "warning",
    message: "no libgcirpc path resolved from GS_LIB_PATH, GS_LIB, or GEMSTONE",
  };
}

async function defaultNativeProbe(options: { nativeSessionWorker: boolean }): Promise<DoctorCheck> {
  try {
    const native = await import("@gemstone-js/native");
    const exports = Object.keys(native).filter((name) => name !== "default").sort();
    const sessionWorkerAvailable = typeof native.createGciSessionWorker === "function";
    const missingWorkerMethods = options.nativeSessionWorker && sessionWorkerAvailable
      ? missingNativeSessionWorkerMethods(native)
      : [];
    if (options.nativeSessionWorker && !sessionWorkerAvailable) {
      return {
        name: "native-package",
        status: "error",
        message: "GS_NATIVE_SESSION_WORKER is enabled but @gemstone-js/native does not export createGciSessionWorker",
        details: { exports, nativeSessionWorker: true, sessionWorkerAvailable },
      };
    }
    if (options.nativeSessionWorker && missingWorkerMethods.length > 0) {
      return {
        name: "native-package",
        status: "error",
        message: `GS_NATIVE_SESSION_WORKER is enabled but GciSessionWorker is missing methods: ${missingWorkerMethods.join(", ")}`,
        details: {
          exports,
          nativeSessionWorker: true,
          sessionWorkerAvailable,
          sessionWorkerSurfaceComplete: false,
          missingWorkerMethods,
        },
      };
    }
    return {
      name: "native-package",
      status: "ok",
      message: options.nativeSessionWorker
        ? "@gemstone-js/native is importable and supports GciSessionWorker"
        : "@gemstone-js/native is importable",
      details: {
        exports,
        nativeSessionWorker: options.nativeSessionWorker,
        sessionWorkerAvailable,
        ...(options.nativeSessionWorker ? { sessionWorkerSurfaceComplete: true } : {}),
      },
    };
  } catch (error) {
    return {
      name: "native-package",
      status: "warning",
      message: "@gemstone-js/native is not importable",
      details: { error: errorMessage(error) },
    };
  }
}

function missingNativeSessionWorkerMethods(native: Record<string, unknown>): string[] {
  const Worker = native.GciSessionWorker as { prototype?: Record<string, unknown> } | undefined;
  const prototype = Worker?.prototype;
  if (!prototype) return [...REQUIRED_NATIVE_SESSION_WORKER_METHODS];
  return REQUIRED_NATIVE_SESSION_WORKER_METHODS.filter((method) => typeof prototype[method] !== "function");
}

async function liveCheck(
  config: SessionConfig,
  connect: (config: SessionConfig) => Promise<DoctorSession>,
): Promise<DoctorCheck> {
  if (!config.username || !config.password) {
    return {
      name: "live-login",
      status: "error",
      message: "skipped because credentials are missing",
    };
  }
  let session: DoctorSession | undefined;
  try {
    session = await connect(config);
    const value = await session.eval("1 + 1");
    return {
      name: "live-login",
      status: "ok",
      message: "connected and evaluated 1 + 1",
      details: { result: value },
    };
  } catch (error) {
    return {
      name: "live-login",
      status: "error",
      message: errorMessage(error),
    };
  } finally {
    await session?.logout().catch(() => undefined);
  }
}

function summarizeStatus(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "ok";
}

function reportConfig(config: SessionConfig): DoctorConfigReport {
  return {
    stone: config.stone ?? "gs64stone",
    netldi: config.netldi ?? "netldi",
    host: config.host ?? "localhost",
    usernameSet: Boolean(config.username),
    passwordSet: Boolean(config.password),
    hostUsernameSet: Boolean(config.hostUsername),
    hostPasswordSet: Boolean(config.hostPassword),
    gemService: config.gemService ?? "gemnetobject",
    nativeSessionWorker: config.nativeSessionWorker === true,
    ...(config.libPath ? { libPath: config.libPath } : {}),
  };
}

function runtimeName(): string {
  const globals = globalThis as {
    Deno?: unknown;
    Bun?: unknown;
    process?: { versions?: { node?: string } };
  };
  if (globals.Deno) return "deno";
  if (globals.Bun) return "bun";
  if (globals.process?.versions?.node) return `node ${globals.process.versions.node}`;
  return "unknown";
}

function defaultEnv(): GciLibraryDiscoveryEnv & Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

function defaultLibraryHost(): GciLibraryDiscoveryHost {
  return {
    listDir(path) {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
