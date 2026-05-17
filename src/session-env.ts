import type { SessionConfig } from "./types.ts";

export type SessionEnv = Record<string, string | undefined>;

export const SESSION_ENV_ALIAS_GROUPS = {
  stone: ["GS_STONE", "GS_STONE_NAME"],
  netldi: ["GS_NETLDI", "GS_NETLDI_NAME_OR_PORT"],
  host: ["GS_HOST", "GS_NETLDI_HOST"],
  username: ["GS_USERNAME", "GS_USER"],
  password: ["GS_PASSWORD", "GS_PASS"],
  gemService: ["GS_GEM_SERVICE", "GS_SERVICE"],
} as const;

export type SessionEnvAliasField = keyof typeof SESSION_ENV_ALIAS_GROUPS;

export interface SessionEnvAliasConflict {
  field: SessionEnvAliasField;
  canonical: string;
  alias: string;
}

export function sessionConfigFromEnv(env: SessionEnv, overrides: SessionConfig = {}): SessionConfig {
  return {
    stone: envValue(env, ...SESSION_ENV_ALIAS_GROUPS.stone) ?? "gs64stone",
    netldi: envValue(env, ...SESSION_ENV_ALIAS_GROUPS.netldi) ?? "netldi",
    host: envValue(env, ...SESSION_ENV_ALIAS_GROUPS.host) ?? "localhost",
    username: envValue(env, ...SESSION_ENV_ALIAS_GROUPS.username),
    password: envValue(env, ...SESSION_ENV_ALIAS_GROUPS.password),
    hostUsername: env.GS_HOST_USERNAME ?? "",
    hostPassword: env.GS_HOST_PASSWORD ?? "",
    gemService: envValue(env, ...SESSION_ENV_ALIAS_GROUPS.gemService) ?? "gemnetobject",
    libPath: env.GS_LIB_PATH,
    nativeSessionWorker: envFlag(env.GS_NATIVE_SESSION_WORKER),
    ...overrides,
  };
}

export function sessionEnvAliasConflicts(env: SessionEnv): SessionEnvAliasConflict[] {
  const conflicts: SessionEnvAliasConflict[] = [];
  for (const field of Object.keys(SESSION_ENV_ALIAS_GROUPS) as SessionEnvAliasField[]) {
    const [canonical, ...aliases] = SESSION_ENV_ALIAS_GROUPS[field];
    const canonicalValue = env[canonical];
    if (!configured(canonicalValue)) continue;
    for (const alias of aliases) {
      const aliasValue = env[alias];
      if (configured(aliasValue) && aliasValue !== canonicalValue) {
        conflicts.push({ field, canonical, alias });
      }
    }
  }
  return conflicts;
}

export function envValue(env: SessionEnv, ...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function configured(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function envFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
