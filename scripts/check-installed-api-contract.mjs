#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempRoot = mkdtempSync(join(tmpdir(), "gemstone-js-installed-api-"));
const cache = join(tempRoot, "npm-cache");
const packageRoot = join(tempRoot, "package");

try {
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", tempRoot], {
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
  });
  const [pack] = JSON.parse(packOutput);
  const tarballPath = join(tempRoot, pack.filename);
  if (!existsSync(tarballPath)) {
    throw new Error(`npm pack did not create expected tarball: ${tarballPath}`);
  }

  mkdirSync(packageRoot, { recursive: true });
  execFileSync("tar", [
    "-xzf",
    tarballPath,
    "-C",
    packageRoot,
    "--strip-components",
    "1",
  ], {
    encoding: "utf8",
    stdio: "pipe",
  });

  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  assertInstalledBins(packageRoot, packageJson.bin ?? {});
  assertInstalledBinHelp(packageRoot, packageJson.bin ?? {});

  const contractOutput = execFileSync(process.execPath, [
    join(packageRoot, "scripts", "api-contract.mjs"),
    "--json",
  ], {
    encoding: "utf8",
    cwd: packageRoot,
    stdio: "pipe",
  });
  const report = JSON.parse(contractOutput);
  if (report.status !== "ok") {
    throw new Error(`Installed API contract failed:\n${contractOutput}`);
  }
  if (report.actualValueExports !== report.expectedValueExports) {
    throw new Error(`Installed API contract export count mismatch:\n${contractOutput}`);
  }
  if (report.packageName !== "gemstone-js") {
    throw new Error(`Installed API contract reported unexpected package name:\n${contractOutput}`);
  }
  if (report.packageFailures.length > 0 || report.binTargetMismatches.length > 0 || report.schemaExportMismatches.length > 0) {
    throw new Error(`Installed package metadata contract failed:\n${contractOutput}`);
  }
  if (report.actualBinEntries !== report.expectedBinEntries) {
    throw new Error(`Installed bin entry count mismatch:\n${contractOutput}`);
  }
  const doctorOutput = execFileSync(process.execPath, [
    join(packageRoot, "scripts", "doctor.mjs"),
    "--json",
    "--no-native",
  ], {
    encoding: "utf8",
    cwd: packageRoot,
    env: { ...process.env, GS_USERNAME: "", GS_PASSWORD: "" },
    stdio: "pipe",
  });
  const doctorReport = JSON.parse(doctorOutput);
  if (doctorReport.status !== "warning" || doctorReport.config.usernameSet !== false) {
    throw new Error(`Installed doctor report did not expose expected local setup warning:\n${doctorOutput}`);
  }

  for (const args of [
    ["scripts/verify-provenance-metadata.mjs", "--self-test"],
    ["scripts/check-release-artifacts.mjs"],
    ["scripts/check-comparison-reports.mjs"],
  ]) {
    execFileSync(process.execPath, args, {
      encoding: "utf8",
      cwd: packageRoot,
      stdio: "pipe",
    });
  }

  const comparisonSchema = JSON.parse(readFileSync(join(packageRoot, "schemas/comparison-report.schema.json"), "utf8"));
  if (
    comparisonSchema.properties?.schema_version?.const !== 1
    || comparisonSchema.properties?.$schema?.const !== "./schemas/comparison-report.schema.json"
  ) {
    throw new Error("Installed comparison report schema is missing the expected version contract.");
  }
  const comparisonOutput = execFileSync(process.execPath, [
    join(packageRoot, "scripts", "compare.mjs"),
    "gemstone-rs",
    "--totals",
    "--json",
  ], {
    encoding: "utf8",
    cwd: packageRoot,
    stdio: "pipe",
  });
  const comparisonReport = JSON.parse(comparisonOutput);
  if (
    comparisonReport.$schema !== "./schemas/comparison-report.schema.json"
    || comparisonReport.schema_version !== 1
    || comparisonReport.comparison !== "gemstone-rs"
    || comparisonReport.totalBatches !== 6
  ) {
    throw new Error(`Installed comparison report is missing expected schema metadata or totals:\n${comparisonOutput}`);
  }

  const examplesOutput = execFileSync(process.execPath, [
    join(packageRoot, "scripts", "examples.mjs"),
    "--json",
  ], {
    encoding: "utf8",
    cwd: packageRoot,
    stdio: "pipe",
  });
  const examples = JSON.parse(examplesOutput);
  if (!examples.some((entry) => entry.name === "web-express") || !examples.some((entry) => entry.name === "quickstart")) {
    throw new Error(`Installed example catalog is missing required examples:\n${examplesOutput}`);
  }
  if (!examples.some((entry) => entry.name === "web-fetch")) {
    throw new Error(`Installed example catalog is missing the Fetch adapter example:\n${examplesOutput}`);
  }
  if (!examples.some((entry) => entry.name === "web-route-handler")) {
    throw new Error(`Installed example catalog is missing the route-handler example:\n${examplesOutput}`);
  }
  const commandsOutput = execFileSync(process.execPath, [
    join(packageRoot, "scripts", "examples.mjs"),
    "--commands",
    "--kind",
    "web",
  ], {
    encoding: "utf8",
    cwd: packageRoot,
    stdio: "pipe",
  });
  if (!commandsOutput.includes("web-fetch") || !commandsOutput.includes("npm install express")) {
    throw new Error(`Installed example command output is missing expected web commands:\n${commandsOutput}`);
  }
  const plansOutput = execFileSync(process.execPath, [
    join(packageRoot, "scripts", "examples.mjs"),
    "--plans",
  ], {
    encoding: "utf8",
    cwd: packageRoot,
    stdio: "pipe",
  });
  if (!plansOutput.includes("first-session") || !plansOutput.includes("web-service")) {
    throw new Error(`Installed example plan output is missing expected plans:\n${plansOutput}`);
  }
  const planCommandsOutput = execFileSync(process.execPath, [
    join(packageRoot, "scripts", "examples.mjs"),
    "--commands",
    "--plan",
    "web-service",
  ], {
    encoding: "utf8",
    cwd: packageRoot,
    stdio: "pipe",
  });
  if (!planCommandsOutput.includes("web-fetch") || !planCommandsOutput.includes("web-hono")) {
    throw new Error(`Installed example plan command output is missing expected commands:\n${planCommandsOutput}`);
  }
  const rootModule = await import("gemstone-js");
  if (
    typeof rootModule.Session !== "function"
    || typeof rootModule.createGciRuntime !== "function"
    || typeof rootModule.sessionConfigFromEnv !== "function"
  ) {
    throw new Error("Installed root module must export Session, createGciRuntime, and sessionConfigFromEnv.");
  }
  const testingModule = await import("gemstone-js/testing");
  if (typeof testingModule.MockGciRuntime !== "function") {
    throw new Error("Installed testing subpath must export MockGciRuntime.");
  }
  const adaptersModule = await import("gemstone-js/adapters");
  if (
    typeof adaptersModule.gemstoneExpress !== "function"
    || typeof adaptersModule.gemstoneFastify !== "function"
    || typeof adaptersModule.gemstoneFetch !== "function"
    || typeof adaptersModule.gemstoneHono !== "function"
  ) {
    throw new Error("Installed adapter aggregate subpath must export Express, Fastify, Fetch, and Hono adapters.");
  }
  const expressAdapter = await import("gemstone-js/adapters/express");
  if (typeof expressAdapter.gemstoneExpress !== "function") {
    throw new Error("Installed Express adapter subpath must export gemstoneExpress.");
  }
  const fastifyAdapter = await import("gemstone-js/adapters/fastify");
  if (typeof fastifyAdapter.gemstoneFastify !== "function") {
    throw new Error("Installed Fastify adapter subpath must export gemstoneFastify.");
  }
  const fetchAdapter = await import("gemstone-js/adapters/fetch");
  if (typeof fetchAdapter.gemstoneFetch !== "function" || typeof fetchAdapter.withGemStoneFetch !== "function") {
    throw new Error("Installed Fetch adapter subpath must export gemstoneFetch and withGemStoneFetch.");
  }
  const honoAdapter = await import("gemstone-js/adapters/hono");
  if (typeof honoAdapter.gemstoneHono !== "function") {
    throw new Error("Installed Hono adapter subpath must export gemstoneHono.");
  }
  assertInstalledTypeConsumer(packageRoot);

  console.log(
    `Installed API contract check passed: ${report.packageName}@${report.version} (${report.actualValueExports} runtime value exports, ${report.actualBinEntries} bins, ${examples.length} examples).`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function assertInstalledBins(root, binEntries) {
  const names = Object.keys(binEntries);
  if (names.length === 0) {
    throw new Error("Installed package has no bin entries.");
  }
  for (const [name, relativePath] of Object.entries(binEntries)) {
    if (!relativePath.startsWith("./scripts/")) {
      throw new Error(`Installed bin ${name} must point under ./scripts/, found ${relativePath}.`);
    }
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Installed bin ${name} target is missing: ${relativePath}.`);
    }
    const firstLine = readFileSync(absolutePath, "utf8").split(/\r?\n/, 1)[0];
    if (firstLine !== "#!/usr/bin/env node") {
      throw new Error(`Installed bin ${name} target must have a Node shebang: ${relativePath}.`);
    }
  }
}

function assertInstalledBinHelp(root, binEntries) {
  for (const [name, relativePath] of Object.entries(binEntries)) {
    const output = execFileSync(process.execPath, [join(root, relativePath), "--help"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GS_USERNAME: "",
        GS_PASSWORD: "",
        GS_USER: "",
        GS_PASS: "",
      },
      stdio: "pipe",
    });
    if (!output.includes("Usage:")) {
      throw new Error(`Installed bin ${name} --help output must include Usage.`);
    }
  }
}

function assertInstalledTypeConsumer(installedPackageRoot) {
  const consumerRoot = join(tempRoot, "type-consumer");
  const nodeModules = join(consumerRoot, "node_modules");
  mkdirSync(nodeModules, { recursive: true });
  symlinkSync(installedPackageRoot, join(nodeModules, "gemstone-js"), "dir");
  writeFileSync(join(consumerRoot, "package.json"), JSON.stringify({
    type: "module",
    private: true,
  }, null, 2));
  writeFileSync(join(consumerRoot, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      lib: ["ES2023", "DOM", "ESNext.Disposable"],
    },
    files: ["consumer.ts"],
  }, null, 2));
  writeFileSync(join(consumerRoot, "consumer.ts"), `
    import {
      Session,
      createGciRuntime,
      sessionConfigFromEnv,
      type GciRuntime,
      type RuntimeName,
      type SessionConfig,
    } from "gemstone-js";
    import { MockGciRuntime } from "gemstone-js/testing";
    import { gemstoneExpress, gemstoneFastify, gemstoneFetch, gemstoneHono } from "gemstone-js/adapters";
    import { gemstoneExpress as expressSubpath } from "gemstone-js/adapters/express";
    import { gemstoneFastify as fastifySubpath } from "gemstone-js/adapters/fastify";
    import { gemstoneFetch as fetchSubpath } from "gemstone-js/adapters/fetch";
    import { gemstoneHono as honoSubpath } from "gemstone-js/adapters/hono";

    const config: SessionConfig = sessionConfigFromEnv({
      GS_USER: "DataCurator",
      GS_PASS: "swordfish",
      GS_NATIVE_SESSION_WORKER: "1",
    });
    const workerFlag: boolean | undefined = config.nativeSessionWorker;
    const runtimeName: RuntimeName = "node-worker";
    const runtimePromise: Promise<GciRuntime> = createGciRuntime({ nativeSessionWorker: true });
    const mockRuntime = new MockGciRuntime();
    const fetchApp = gemstoneFetch(async (_request, context) => {
      const value: unknown = await context.session.eval("1 + 1");
      return new Response(String(value));
    }, { runtime: mockRuntime, username: "DataCurator", password: "swordfish" });

    void [
      Session,
      workerFlag,
      runtimeName,
      runtimePromise,
      mockRuntime,
      fetchApp,
      gemstoneExpress,
      gemstoneFastify,
      gemstoneFetch,
      gemstoneHono,
      expressSubpath,
      fastifySubpath,
      fetchSubpath,
      honoSubpath,
    ];
  `);
  execFileSync(process.execPath, [typescriptBin(), "-p", join(consumerRoot, "tsconfig.json")], {
    cwd: consumerRoot,
    encoding: "utf8",
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
  throw new Error("Installed type-consumer check requires node_modules/typescript/bin/tsc.");
}
