#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const nativeRoot = resolve(packageRoot, "..", "gemstone-js-native");
const tempRoot = mkdtempSync(join(tmpdir(), "gemstone-js-native-install-"));
const cache = join(tempRoot, "npm-cache");
const appRoot = join(tempRoot, "app");

try {
  if (!existsSync(join(nativeRoot, "package.json"))) {
    throw new Error(`Cannot find sibling @gemstone-js/native checkout at ${nativeRoot}.`);
  }

  mkdirSync(appRoot, { recursive: true });
  writeFileSync(join(appRoot, "package.json"), JSON.stringify({
    type: "module",
    private: true,
    dependencies: {},
  }, null, 2));

  const nativePack = packProject(nativeRoot);
  const jsPack = packProject(packageRoot);
  assertPackMetadata(nativePack);
  assertPackMetadata(jsPack);
  assertNativeVersionParity(nativePack);
  assertNativeTarballContents(nativePack);

  execFileSync("npm", [
    "install",
    "--omit=dev",
    "--audit=false",
    "--fund=false",
    nativePack.tarballPath,
    jsPack.tarballPath,
  ], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
    stdio: "pipe",
  });
  assertInstalledPackageGraph(jsPack, nativePack);

  const probe = `
    import { createGciRuntime, sessionConfigFromEnv } from "gemstone-js";
    import * as native from "@gemstone-js/native";

    if (typeof native.createGciSessionWorker !== "function") {
      throw new Error("@gemstone-js/native must export createGciSessionWorker().");
    }
    if (typeof native.GciSessionWorker !== "function") {
      throw new Error("@gemstone-js/native must export GciSessionWorker.");
    }
    const config = sessionConfigFromEnv({
      GS_USER: "DataCurator",
      GS_PASS: "swordfish",
      GS_NATIVE_SESSION_WORKER: "1",
    });
    if (config.nativeSessionWorker !== true) {
      throw new Error("sessionConfigFromEnv() must parse GS_NATIVE_SESSION_WORKER=1.");
    }
    const runtime = await createGciRuntime({ nativeSessionWorker: true });
    if (runtime.name !== "node-worker") {
      throw new Error("createGciRuntime({ nativeSessionWorker: true }) must select node-worker.");
    }
    const worker = native.createGciSessionWorker(null);
    await worker.close();
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: appRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  const installedPackageRoot = join(appRoot, "node_modules", "gemstone-js");
  const doctorOutput = execFileSync(process.execPath, [
    join(installedPackageRoot, "scripts", "doctor.mjs"),
    "--json",
    "--no-native",
  ], {
    cwd: appRoot,
    encoding: "utf8",
    env: { ...process.env, GS_USERNAME: "", GS_PASSWORD: "" },
    stdio: "pipe",
  });
  const doctorReport = JSON.parse(doctorOutput);
  if (doctorReport.status !== "warning" || doctorReport.config?.usernameSet !== false) {
    throw new Error(`Installed doctor CLI did not run from node_modules with expected warning:\n${doctorOutput}`);
  }
  const workerDoctorOutput = execFileSync(process.execPath, [
    join(installedPackageRoot, "scripts", "doctor.mjs"),
    "--json",
  ], {
    cwd: appRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GS_USERNAME: "DataCurator",
      GS_PASSWORD: "swordfish",
      GS_NATIVE_SESSION_WORKER: "1",
    },
    stdio: "pipe",
  });
  const workerDoctorReport = JSON.parse(workerDoctorOutput);
  const nativeCheck = workerDoctorReport.checks?.find((check) => check.name === "native-package");
  if (
    workerDoctorReport.config?.nativeSessionWorker !== true
    || nativeCheck?.status !== "ok"
    || nativeCheck.details?.nativeSessionWorker !== true
    || nativeCheck.details?.sessionWorkerAvailable !== true
    || nativeCheck.details?.sessionWorkerSurfaceComplete !== true
  ) {
    throw new Error(`Installed doctor CLI did not report native worker support:\n${workerDoctorOutput}`);
  }

  const examplesOutput = execFileSync(process.execPath, [
    join(installedPackageRoot, "scripts", "examples.mjs"),
    "--json",
  ], {
    cwd: appRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  const examples = JSON.parse(examplesOutput);
  if (!Array.isArray(examples) || !examples.some((entry) => entry.name === "quickstart")) {
    throw new Error(`Installed examples CLI did not report the quickstart example:\n${examplesOutput}`);
  }
  assertNativeTypeConsumer();
  if (process.env.GS_RUN_LIVE === "1") {
    assertInstalledLiveWorkerSmoke();
  }

  console.log(`Native install check passed: ${jsPack.name}@${jsPack.version} with ${nativePack.name}@${nativePack.version}.`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function packProject(root) {
  const output = execFileSync("npm", ["pack", "--json", "--pack-destination", tempRoot], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
    stdio: "pipe",
  });
  const [pack] = JSON.parse(output);
  const tarballPath = join(tempRoot, pack.filename);
  if (!existsSync(tarballPath)) {
    throw new Error(`npm pack did not create expected tarball: ${tarballPath}`);
  }
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return {
    name: packageJson.name,
    version: packageJson.version,
    filename: pack.filename,
    integrity: pack.integrity,
    shasum: pack.shasum,
    files: pack.files?.map((file) => file.path) ?? [],
    tarballPath,
  };
}

function assertPackMetadata(pack) {
  if (!pack.filename?.endsWith(".tgz")) {
    throw new Error(`${pack.name} npm pack output must include a .tgz filename.`);
  }
  if (typeof pack.integrity !== "string" || !pack.integrity.startsWith("sha512-")) {
    throw new Error(`${pack.name} npm pack output must include sha512 integrity metadata.`);
  }
  if (typeof pack.shasum !== "string" || !/^[a-f0-9]{40}$/i.test(pack.shasum)) {
    throw new Error(`${pack.name} npm pack output must include a sha1 shasum.`);
  }
}

function assertNativeVersionParity(nativePack) {
  const jsPackage = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const expected = jsPackage.optionalDependencies?.["@gemstone-js/native"];
  if (expected !== nativePack.version) {
    throw new Error(
      `gemstone-js optionalDependencies["@gemstone-js/native"] must match the sibling native package version ${nativePack.version}; found ${JSON.stringify(expected)}.`,
    );
  }
}

function assertNativeTarballContents(nativePack) {
  const files = new Set(nativePack.files);
  for (const required of [
    "index.js",
    "index.d.ts",
    "session-worker.js",
    "session-worker-thread.js",
    "scripts/check-prebuild-artifacts.mjs",
    "scripts/check-release-artifacts.mjs",
    "scripts/verify-provenance-metadata.mjs",
  ]) {
    if (!files.has(required)) {
      throw new Error(`@gemstone-js/native package tarball is missing required entry: ${required}`);
    }
  }
  if (!nativePack.files.some((file) => file.endsWith(".node"))) {
    throw new Error("@gemstone-js/native package tarball must include a native .node binary.");
  }
}

function assertInstalledPackageGraph(jsPack, nativePack) {
  const jsPackage = JSON.parse(readFileSync(join(appRoot, "node_modules", "gemstone-js", "package.json"), "utf8"));
  const nativePackage = JSON.parse(readFileSync(join(appRoot, "node_modules", "@gemstone-js", "native", "package.json"), "utf8"));
  if (jsPackage.version !== jsPack.version) {
    throw new Error(`Installed gemstone-js version mismatch: expected ${jsPack.version}, found ${jsPackage.version}.`);
  }
  if (nativePackage.version !== nativePack.version) {
    throw new Error(`Installed @gemstone-js/native version mismatch: expected ${nativePack.version}, found ${nativePackage.version}.`);
  }
  if (jsPackage.optionalDependencies?.["@gemstone-js/native"] !== nativePack.version) {
    throw new Error("Installed gemstone-js package metadata does not declare the installed @gemstone-js/native version.");
  }
  const graph = JSON.parse(execFileSync("npm", ["ls", "--json", "--depth=0"], {
    cwd: appRoot,
    encoding: "utf8",
    stdio: "pipe",
  }));
  if (graph.dependencies?.["gemstone-js"]?.version !== jsPack.version) {
    throw new Error(`npm ls did not resolve gemstone-js@${jsPack.version}.`);
  }
  if (graph.dependencies?.["@gemstone-js/native"]?.version !== nativePack.version) {
    throw new Error(`npm ls did not resolve @gemstone-js/native@${nativePack.version}.`);
  }
}

function assertNativeTypeConsumer() {
  writeFileSync(join(appRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      lib: ["ES2023", "DOM", "ESNext.Disposable"],
    },
    files: ["native-consumer.ts"],
  }, null, 2));
  writeFileSync(join(appRoot, "native-consumer.ts"), `
    import {
      createGciRuntime,
      sessionConfigFromEnv,
      type GciRuntime,
      type SessionConfig,
    } from "gemstone-js";
    import {
      GciSessionWorker,
      createGciSessionWorker,
      isGemStoneNativeError,
      type GemStoneNativeError,
    } from "@gemstone-js/native";

    const config: SessionConfig = sessionConfigFromEnv({
      GS_USER: "DataCurator",
      GS_PASS: "swordfish",
      GS_NATIVE_SESSION_WORKER: "1",
    });
    const runtimePromise: Promise<GciRuntime> = createGciRuntime({ nativeSessionWorker: true });
    const worker: GciSessionWorker = createGciSessionWorker(null);
    const closePromise: Promise<void> = worker.close();
    const error: unknown = new Error("native probe");
    const mapped: GemStoneNativeError | undefined = isGemStoneNativeError(error) ? error : undefined;

    void [config, runtimePromise, worker, closePromise, mapped];
  `);
  execFileSync(process.execPath, [typescriptBin(), "-p", join(appRoot, "tsconfig.json")], {
    cwd: appRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function assertInstalledLiveWorkerSmoke() {
  const liveProbe = `
    import { Session, smallintToOop } from "gemstone-js";

    const session = await Session.connect(Session.configFromEnv({ nativeSessionWorker: true }));
    try {
      if (session.runtime.name !== "node-worker") {
        throw new Error("Installed live smoke must use the node-worker backend.");
      }
      const sum = await session.eval("1 + 1");
      if (sum !== 2n) throw new Error("Installed live smoke eval returned " + String(sum));
      const value = await session.performValueWith(smallintToOop(7), "yourself");
      if (value !== 7n) throw new Error("Installed live smoke performValueWith returned " + String(value));
      const stringOop = await session.newString("gemstone-js installed live");
      const stringValue = await session.marshalOop(stringOop);
      if (stringValue !== "gemstone-js installed live") {
        throw new Error("Installed live smoke string round-trip returned " + String(stringValue));
      }
    } finally {
      await session.logout();
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", liveProbe], {
    cwd: appRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GS_RUN_LIVE: "1",
      GS_NATIVE_SESSION_WORKER: "1",
    },
    stdio: "pipe",
  });
}

function typescriptBin() {
  for (const candidate of [
    join(process.cwd(), "node_modules", "typescript", "bin", "tsc"),
    join(packageRoot, "node_modules", "typescript", "bin", "tsc"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Native install type-consumer check requires node_modules/typescript/bin/tsc.");
}
