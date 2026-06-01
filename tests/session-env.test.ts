import assert from "node:assert/strict";
import test from "node:test";
import {
  GemStoneConfigurationError,
  Session,
  resolveSessionConfig,
  sessionConfigFromEnv,
  sessionEnvAliasConflicts,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

const SESSION_ENV_KEYS = [
  "GS_STONE",
  "GS_STONE_NAME",
  "GS_NETLDI",
  "GS_NETLDI_NAME_OR_PORT",
  "GS_HOST",
  "GS_NETLDI_HOST",
  "GS_USERNAME",
  "GS_USER",
  "GS_PASSWORD",
  "GS_PASS",
  "GS_GEM_SERVICE",
  "GS_SERVICE",
  "GS_LIB_PATH",
  "GS_NATIVE_SESSION_WORKER",
];

test("Session.configFromEnv accepts Pharo bridge compatibility aliases", () => {
  const config = withSessionEnv({
    GS_STONE_NAME: "aliasStone",
    GS_NETLDI_NAME_OR_PORT: "50377",
    GS_NETLDI_HOST: "stone.example.com",
    GS_USER: "DataCurator",
    GS_PASS: "swordfish",
    GS_SERVICE: "gemnetobject-special",
    GS_LIB_PATH: "/gem/lib/libgcirpc.dylib",
  }, () => Session.configFromEnv());

  assert.equal(config.stone, "aliasStone");
  assert.equal(config.netldi, "50377");
  assert.equal(config.host, "stone.example.com");
  assert.equal(config.username, "DataCurator");
  assert.equal(config.password, "swordfish");
  assert.equal(config.gemService, "gemnetobject-special");
  assert.equal(config.libPath, "/gem/lib/libgcirpc.dylib");
});

test("Session.configFromEnv accepts native session worker switch", () => {
  const config = withSessionEnv({
    GS_USER: "DataCurator",
    GS_PASS: "swordfish",
    GS_NATIVE_SESSION_WORKER: "1",
  }, () => Session.configFromEnv());

  assert.equal(config.nativeSessionWorker, true);

  const disabled = withSessionEnv({
    GS_USER: "DataCurator",
    GS_PASS: "swordfish",
    GS_NATIVE_SESSION_WORKER: "0",
  }, () => Session.configFromEnv());

  assert.equal(disabled.nativeSessionWorker, false);
});

test("Session.connectFromEnv and withEnv use environment config with overrides", async () => {
  const runtime = new MockGciRuntime();
  const session = await withSessionEnv({
    GS_USER: "DataCurator",
    GS_PASS: "swordfish",
  }, () => Session.connectFromEnv({ runtime }));
  try {
    assert.equal(session.config.username, "DataCurator");
    assert.equal(session.config.password, "swordfish");
  } finally {
    await session.logout();
  }

  const result = await withSessionEnv({
    GS_USER: "DataCurator",
    GS_PASS: "swordfish",
  }, () => Session.withEnv((session) => session.config.username, { runtime: new MockGciRuntime() }));

  assert.equal(result, "DataCurator");
});

test("sessionConfigFromEnv resolves explicit env objects without touching process env", () => {
  const config = sessionConfigFromEnv({
    GS_USER: "DataCurator",
    GS_PASS: "swordfish",
  }, {
    stone: "overrideStone",
  });

  assert.equal(config.stone, "overrideStone");
  assert.equal(config.netldi, "netldi");
  assert.equal(config.host, "localhost");
  assert.equal(config.username, "DataCurator");
  assert.equal(config.password, "swordfish");
});

test("Session.configFromEnv prefers canonical names over compatibility aliases", () => {
  const config = withSessionEnv({
    GS_STONE: "canonicalStone",
    GS_STONE_NAME: "aliasStone",
    GS_NETLDI: "canonicalLdi",
    GS_NETLDI_NAME_OR_PORT: "50377",
    GS_HOST: "canonical.example.com",
    GS_NETLDI_HOST: "alias.example.com",
    GS_USERNAME: "SystemUser",
    GS_USER: "DataCurator",
    GS_PASSWORD: "canonical-secret",
    GS_PASS: "alias-secret",
    GS_GEM_SERVICE: "canonical-gem",
    GS_SERVICE: "alias-gem",
  }, () => Session.configFromEnv());

  assert.equal(config.stone, "canonicalStone");
  assert.equal(config.netldi, "canonicalLdi");
  assert.equal(config.host, "canonical.example.com");
  assert.equal(config.username, "SystemUser");
  assert.equal(config.password, "canonical-secret");
  assert.equal(config.gemService, "canonical-gem");
});

test("Session.configFromEnv falls back to aliases when canonical names are empty", () => {
  const config = withSessionEnv({
    GS_NETLDI: "",
    GS_NETLDI_NAME_OR_PORT: "50377",
    GS_HOST: "",
    GS_NETLDI_HOST: "stone.example.com",
    GS_USERNAME: "",
    GS_USER: "DataCurator",
    GS_PASSWORD: "",
    GS_PASS: "swordfish",
    GS_GEM_SERVICE: "",
    GS_SERVICE: "gemnetobject-special",
  }, () => Session.configFromEnv());

  assert.equal(config.netldi, "50377");
  assert.equal(config.host, "stone.example.com");
  assert.equal(config.username, "DataCurator");
  assert.equal(config.password, "swordfish");
  assert.equal(config.gemService, "gemnetobject-special");
});

test("resolveSessionConfig mentions canonical and compatibility credential names", () => {
  withSessionEnv({}, () => {
    assert.throws(
      () => resolveSessionConfig(),
      (error) => error instanceof GemStoneConfigurationError
        && /GS_USERNAME or GS_USER/.test(error.message)
        && /GS_PASSWORD or GS_PASS/.test(error.message),
    );
  });
});

test("sessionEnvAliasConflicts reports only mismatched configured aliases", () => {
  const conflicts = sessionEnvAliasConflicts({
    GS_USERNAME: "SystemUser",
    GS_USER: "DataCurator",
    GS_PASSWORD: "secret",
    GS_PASS: "secret",
    GS_HOST: "",
    GS_NETLDI_HOST: "stone.example.com",
    GS_NETLDI: "netldi",
    GS_NETLDI_NAME_OR_PORT: "50377",
  });

  assert.deepEqual(conflicts, [
    { field: "netldi", canonical: "GS_NETLDI", alias: "GS_NETLDI_NAME_OR_PORT" },
    { field: "username", canonical: "GS_USERNAME", alias: "GS_USER" },
  ]);
});

function withSessionEnv<T>(values: Record<string, string>, callback: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of SESSION_ENV_KEYS) {
    previous.set(key, process.env[key]);
    delete process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(values)) {
      process.env[key] = value;
    }
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
