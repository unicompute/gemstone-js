import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cache = mkdtempSync(join(tmpdir(), "gemstone-js-npm-cache-"));

let pack;
try {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
  });
  [pack] = JSON.parse(output);
} finally {
  rmSync(cache, { recursive: true, force: true });
}

const files = pack.files.map((file) => file.path);
const fileSet = new Set(files);
const packedFileByPath = new Map(pack.files.map((file) => [file.path, file]));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const nativeDeclaration = readFileSync("src/native-module.d.ts", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const frameworkDocs = readFileSync("docs/framework-adapters.md", "utf8");
const betaDocs = readFileSync("docs/beta.md", "utf8");
const examplesGuideDocs = readFileSync("docs/examples-guide.md", "utf8");
const doctorDocs = readFileSync("docs/doctor.md", "utf8");
const jsComparisonDocs = readFileSync("docs/gemstone-js-vs-gemstone-py.md", "utf8");
const parityDocs = readFileSync("docs/gemstone-py-parity.md", "utf8");
const rustComparisonDocs = readFileSync("docs/gemstone-rs-comparison.md", "utf8");
const releasingDocs = readFileSync("docs/releasing.md", "utf8");
const checksumCheck = readFileSync("scripts/check-checksums.mjs", "utf8");
const checksumWriter = readFileSync("scripts/write-checksums.mjs", "utf8");
const checksumVerifier = readFileSync("scripts/verify-checksums.mjs", "utf8");
const provenanceVerifier = readFileSync("scripts/verify-provenance-metadata.mjs", "utf8");
const apiContract = readFileSync("scripts/api-contract.mjs", "utf8");
const compareCli = readFileSync("scripts/compare.mjs", "utf8");
const comparisonCheck = readFileSync("scripts/check-comparison-reports.mjs", "utf8");
const comparisonSchema = JSON.parse(readFileSync("schemas/comparison-report.schema.json", "utf8"));
const examplesCatalog = readFileSync("scripts/examples-catalog.mjs", "utf8");
const examplesCli = readFileSync("scripts/examples.mjs", "utf8");
const examplesCheck = readFileSync("scripts/check-examples.mjs", "utf8");
const installedApiContractCheck = readFileSync("scripts/check-installed-api-contract.mjs", "utf8");
const nativeInstallCheck = readFileSync("scripts/check-native-install.mjs", "utf8");
const publicSurfaceCheck = readFileSync("scripts/check-public-surface.mjs", "utf8");
const publicSurfaceContract = JSON.parse(readFileSync("scripts/public-surface.expected.json", "utf8"));
const releaseArtifactCheck = readFileSync("scripts/check-release-artifacts.mjs", "utf8");
const ciArtifactReview = readFileSync("scripts/review-ci-artifact.mjs", "utf8");
const liveSmokeCheck = readFileSync("scripts/check-live-smoke.mjs", "utf8");
const sessionEnvSource = readFileSync("src/session-env.ts", "utf8");
const doctorSource = readFileSync("src/doctor.ts", "utf8");
const nodeRuntimeSource = readFileSync("src/runtime/node.ts", "utf8");
const runtimeFfiTests = readFileSync("tests/runtime-ffi.test.ts", "utf8");

if (packageJson.publishConfig?.provenance !== true) {
  throw new Error("package.json publishConfig.provenance must be true.");
}
for (const schemaExport of [
  "./schemas/codegen-manifest.schema.json",
  "./schemas/benchmark-report.schema.json",
  "./schemas/benchmark-baseline-manifest.schema.json",
  "./schemas/comparison-report.schema.json",
]) {
  if (packageJson.exports?.[schemaExport] !== schemaExport) {
    throw new Error(`package.json must export ${schemaExport}.`);
  }
}
if (
  packageJson.main !== "./dist/index.js"
  || packageJson.types !== "./dist/index.d.ts"
  || packageJson.exports?.["."]?.import !== "./dist/index.js"
  || packageJson.exports?.["."]?.types !== "./dist/index.d.ts"
) {
  throw new Error("package.json root main/types/export must point at compiled dist/index.js and dist/index.d.ts.");
}
for (const [name, target] of Object.entries({
  "./adapters": "./dist/adapters/index.js",
  "./adapters/express": "./dist/adapters/express.js",
  "./adapters/fastify": "./dist/adapters/fastify.js",
  "./adapters/fetch": "./dist/adapters/fetch.js",
  "./adapters/hono": "./dist/adapters/hono.js",
})) {
  const entry = packageJson.exports?.[name];
  const typeTarget = target.replace(/\.js$/, ".d.ts");
  if (entry?.types !== typeTarget || entry?.import !== target) {
    throw new Error(`package.json must export ${name} import at ${target} and types at ${typeTarget}.`);
  }
}
const requiredScripts = {
  "api-contract": "node scripts/api-contract.mjs",
  "api-contract:json": "node scripts/api-contract.mjs --json",
  "api-contract:installed": "node scripts/check-installed-api-contract.mjs",
  "benchmark:baselines": "node scripts/benchmark-baselines.mjs",
  "benchmark:compare": "node scripts/benchmark-compare.mjs",
  "benchmark:register": "node scripts/benchmark-register.mjs",
  "benchmark:validate": "node scripts/benchmark-validate.mjs",
  "benchmarks": "node scripts/benchmarks.mjs",
  "bootstrap": "node scripts/bootstrap.mjs",
  "build": "node scripts/build-dist.mjs",
  "codegen:check": "node scripts/codegen.mjs --check examples/codegen.manifest.json examples/codegen.generated.ts",
  "codegen:scan:check": "node scripts/scan-codegen.mjs --module --check --out examples/booking.decorators.generated.ts examples/booking.decorators.ts",
  "compare": "node scripts/compare.mjs",
  "compare:check": "node scripts/check-comparison-reports.mjs",
  "doctor": "node scripts/doctor.mjs",
  "examples": "node scripts/examples.mjs",
  "examples:json": "node scripts/examples.mjs --json",
  "examples:check": "node scripts/check-examples.mjs",
  "inspect": "node scripts/inspect.mjs",
  "migrations": "node scripts/migrations.mjs",
  "public-surface:check": "node scripts/check-public-surface.mjs",
  "public-surface:write": "node scripts/check-public-surface.mjs --write",
  "checksum:check": "node scripts/check-checksums.mjs",
  "checksum:verify": "node scripts/verify-checksums.mjs",
  "provenance:check": "node scripts/verify-provenance-metadata.mjs --self-test",
  "pack:check": "node scripts/check-package.mjs",
  "prepack": "npm run build",
  "release:check": "node scripts/check-release-artifacts.mjs",
  "release-candidate:check": "node scripts/check-release-candidate.mjs",
  "ci-artifact:review": "node scripts/review-ci-artifact.mjs",
  "native-install:check": "node scripts/check-native-install.mjs",
  "live:check": "node scripts/check-live-smoke.mjs",
  "verify": "npm run typecheck && npm run codegen:check && npm run codegen:scan:check && npm run examples:check && npm run compare:check && npm run public-surface:check && npm run build && npm run api-contract && npm test && npm run live:check && npm run checksum:check && npm run provenance:check && npm run pack:check && npm run release:check && npm run api-contract:installed",
  "test:live:worker": "GS_RUN_LIVE=1 GS_NATIVE_SESSION_WORKER=1 node --test tests/live.test.ts",
};
for (const [name, command] of Object.entries(requiredScripts)) {
  if (packageJson.scripts?.[name] !== command) {
    throw new Error(`package.json script ${name} must be ${JSON.stringify(command)}.`);
  }
}
if (packageJson.bin?.["gemstone-js-inspect"] !== "./scripts/inspect.mjs") {
  throw new Error("package.json bin.gemstone-js-inspect must point at ./scripts/inspect.mjs.");
}
if (packageJson.bin?.["gemstone-js-bootstrap"] !== "./scripts/bootstrap.mjs") {
  throw new Error("package.json bin.gemstone-js-bootstrap must point at ./scripts/bootstrap.mjs.");
}
if (packageJson.bin?.["gemstone-js-compare"] !== "./scripts/compare.mjs") {
  throw new Error("package.json bin.gemstone-js-compare must point at ./scripts/compare.mjs.");
}
if (packageJson.bin?.["gemstone-js-doctor"] !== "./scripts/doctor.mjs") {
  throw new Error("package.json bin.gemstone-js-doctor must point at ./scripts/doctor.mjs.");
}
if (packageJson.bin?.["gemstone-js-examples"] !== "./scripts/examples.mjs") {
  throw new Error("package.json bin.gemstone-js-examples must point at ./scripts/examples.mjs.");
}
if (packageJson.bin?.["gemstone-js-benchmark-baselines"] !== "./scripts/benchmark-baselines.mjs") {
  throw new Error("package.json bin.gemstone-js-benchmark-baselines must point at ./scripts/benchmark-baselines.mjs.");
}
if (packageJson.bin?.["gemstone-js-benchmark-compare"] !== "./scripts/benchmark-compare.mjs") {
  throw new Error("package.json bin.gemstone-js-benchmark-compare must point at ./scripts/benchmark-compare.mjs.");
}
if (packageJson.bin?.["gemstone-js-benchmark-register"] !== "./scripts/benchmark-register.mjs") {
  throw new Error("package.json bin.gemstone-js-benchmark-register must point at ./scripts/benchmark-register.mjs.");
}
if (packageJson.bin?.["gemstone-js-benchmark-validate"] !== "./scripts/benchmark-validate.mjs") {
  throw new Error("package.json bin.gemstone-js-benchmark-validate must point at ./scripts/benchmark-validate.mjs.");
}
if (packageJson.bin?.["gemstone-js-benchmarks"] !== "./scripts/benchmarks.mjs") {
  throw new Error("package.json bin.gemstone-js-benchmarks must point at ./scripts/benchmarks.mjs.");
}
if (packageJson.bin?.["gemstone-js-api-contract"] !== "./scripts/api-contract.mjs") {
  throw new Error("package.json bin.gemstone-js-api-contract must point at ./scripts/api-contract.mjs.");
}
if (packageJson.bin?.["gemstone-js-migrations"] !== "./scripts/migrations.mjs") {
  throw new Error("package.json bin.gemstone-js-migrations must point at ./scripts/migrations.mjs.");
}
for (const [name, target] of Object.entries(packageJson.bin ?? {})) {
  if (!target.startsWith("./scripts/") || !target.endsWith(".mjs")) {
    throw new Error(`package.json bin ${name} must point at a ./scripts/*.mjs entrypoint.`);
  }
  const packedPath = target.slice(2);
  const packedFile = packedFileByPath.get(packedPath);
  if (!packedFile) {
    throw new Error(`npm pack is missing bin target ${name}: ${packedPath}.`);
  }
  if ((packedFile.mode & 0o111) === 0) {
    throw new Error(`npm pack bin target ${name} must be executable: ${packedPath}.`);
  }
  const source = readFileSync(packedPath, "utf8");
  if (!source.startsWith("#!/usr/bin/env node\n")) {
    throw new Error(`bin target ${name} must start with a Node shebang: ${packedPath}.`);
  }
}
runRequiredCheck("codegen manifest output", ["scripts/codegen.mjs", "--check", "examples/codegen.manifest.json", "examples/codegen.generated.ts"]);
runRequiredCheck("decorated-source codegen output", [
  "scripts/scan-codegen.mjs",
  "--module",
  "--check",
  "--out",
  "examples/booking.decorators.generated.ts",
  "examples/booking.decorators.ts",
]);
runRequiredCheck("live codegen fixture output", [
  "scripts/codegen.mjs",
  "--check",
  "tests/fixtures/live-codegen.manifest.json",
  "tests/fixtures/live-codegen.generated.ts",
]);
runRequiredCheck("example syntax", ["scripts/check-examples.mjs"]);
runRequiredCheck("example catalog kind filter", ["scripts/examples.mjs", "--kind", "data"]);
runRequiredCheck("example catalog JSON kind filter", ["scripts/examples.mjs", "--json", "--kind", "ops"]);
runRequiredCheck("example catalog command list", ["scripts/examples.mjs", "--commands", "--kind", "web"]);
runRequiredCheck("example plan list", ["scripts/examples.mjs", "--plans"]);
runRequiredCheck("example plan details", ["scripts/examples.mjs", "--plan", "data-persistence"]);
runRequiredCheck("example plan commands", ["scripts/examples.mjs", "--commands", "--plan", "web-service"]);
runRequiredCheck("comparison scorecard", ["scripts/compare.mjs", "gemstone-rs", "--scorecard"]);
runRequiredCheck("comparison batch totals", ["scripts/compare.mjs", "all", "--totals", "--json"]);
runRequiredCheck("comparison report matrix", ["scripts/check-comparison-reports.mjs"]);
runRequiredCheck("doctor help", ["scripts/doctor.mjs", "--help"]);
runRequiredCheck("doctor json", ["scripts/doctor.mjs", "--json", "--no-native"]);
runRequiredCheck("live smoke guard", ["scripts/check-live-smoke.mjs"]);
runRequiredCheck("public surface contract", ["scripts/check-public-surface.mjs"]);
runRequiredCheck("runtime API contract", ["scripts/api-contract.mjs"]);

const required = [
  "LICENSE",
  "README.md",
  "docs/architecture.md",
  "docs/beta.md",
  "docs/benchmarks.md",
  "docs/doctor.md",
  "docs/examples-guide.md",
  "docs/framework-adapters.md",
  "docs/gemstone-js-vs-gemstone-py.md",
  "docs/gemstone-py-parity.md",
  "docs/gemstone-rs-comparison.md",
  "docs/migrations.md",
  "docs/naming.md",
  "docs/releasing.md",
  "examples/booking.decorators.generated.ts",
  "examples/booking.decorators.ts",
  "examples/booking.ts",
  "examples/bulk-perform.ts",
  "examples/codegen.generated.ts",
  "examples/codegen.manifest.json",
  "examples/explorer.ts",
  "examples/gstore.ts",
  "examples/migrations.ts",
  "examples/object-log.ts",
  "examples/persistent-root.ts",
  "examples/quickstart.ts",
  "examples/query.ts",
  "examples/web-express.ts",
  "examples/web-fastify.ts",
  "examples/web-fetch.ts",
  "examples/web-hono.ts",
  "examples/web-route-handler.ts",
  "package.json",
  "schemas/benchmark-baseline-manifest.schema.json",
  "schemas/benchmark-report.schema.json",
  "schemas/codegen-manifest.schema.json",
  "schemas/comparison-report.schema.json",
  "scripts/api-contract.mjs",
  "scripts/benchmark-baselines.mjs",
  "scripts/benchmark-compare.mjs",
  "scripts/benchmark-register.mjs",
  "scripts/benchmark-validate.mjs",
  "scripts/benchmarks.mjs",
  "scripts/bootstrap.mjs",
  "scripts/build-dist.mjs",
  "scripts/check-checksums.mjs",
  "scripts/check-comparison-reports.mjs",
  "scripts/check-examples.mjs",
  "scripts/check-installed-api-contract.mjs",
  "scripts/check-live-smoke.mjs",
  "scripts/check-native-install.mjs",
  "scripts/check-package.mjs",
  "scripts/check-public-surface.mjs",
  "scripts/check-release-candidate.mjs",
  "scripts/check-release-artifacts.mjs",
  "scripts/codegen.mjs",
  "scripts/compare.mjs",
  "scripts/doctor.mjs",
  "scripts/examples-catalog.mjs",
  "scripts/examples.mjs",
  "scripts/inspect.mjs",
  "scripts/load-package-module.mjs",
  "scripts/migrations.mjs",
  "scripts/public-surface.expected.json",
  "scripts/review-ci-artifact.mjs",
  "scripts/scan-codegen.mjs",
  "scripts/verify-checksums.mjs",
  "scripts/verify-provenance-metadata.mjs",
  "scripts/write-checksums.mjs",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/runtime/node.js",
  "dist/runtime/node.d.ts",
  "src/index.ts",
  "src/benchmark-baselines.ts",
  "src/benchmarks.ts",
  "src/bootstrap.ts",
  "src/client.ts",
  "src/doctor.ts",
  "src/gstore.ts",
  "src/inspection-cli.ts",
  "src/migrations.ts",
  "src/object-log.ts",
  "src/reduced-conflict.ts",
  "src/smalltalk-source.ts",
  "src/runtime/node.ts",
  "src/runtime/library-discovery.ts",
  "src/session-env.ts",
  "src/testing/mock-runtime.ts",
  "src/adapters/index.ts",
  "src/adapters/express.ts",
  "src/adapters/fastify.ts",
  "src/adapters/fetch.ts",
  "src/adapters/hono.ts",
  "src/native-module.d.ts",
];

const forbidden = [
  ".DS_Store",
  "tests",
  "tsconfig.json",
  "tsconfig.build.json",
];

for (const path of required) {
  if (!fileSet.has(path)) {
    throw new Error(`npm pack is missing required file: ${path}`);
  }
}
for (const snippet of ["interface GemStoneNativeError", "isGemStoneNativeError(error: unknown)"]) {
  if (!nativeDeclaration.includes(snippet)) {
    throw new Error(`src/native-module.d.ts is missing native error guard declaration: ${snippet}`);
  }
}
for (const snippet of ["class GciSessionWorker", "createGciSessionWorker", "close(): Promise<void>"]) {
  if (!nativeDeclaration.includes(snippet)) {
    throw new Error(`src/native-module.d.ts is missing native session worker declaration: ${snippet}`);
  }
}
for (const snippet of ["category: string", "context: string", "exceptionObj: string", "args: string[]"]) {
  if (!nativeDeclaration.includes(snippet)) {
    throw new Error(`src/native-module.d.ts is missing native GciErrorInfo field: ${snippet}`);
  }
}
assertDistDeclarationsUseJs("dist");
assertSnippets(
  ".github/workflows/ci.yml",
  ciWorkflow,
  [
    "npm run verify",
    "npm pack --json",
    "node scripts/write-checksums.mjs .tgz",
    "node scripts/verify-checksums.mjs SHA256SUMS.txt",
    "npm run ci-artifact:review -- --dir .",
    "SHA256SUMS.txt",
    "actions/upload-artifact@v4",
  ],
);
assertSnippets(
  "docs/beta.md",
  betaDocs,
  [
    "Beta Guide",
    "npm install gemstone-js @gemstone-js/native",
    "GS_NATIVE_SESSION_WORKER=1",
    "npm run native-install:check",
    "npm run release-candidate:check",
    "Generated Wrappers",
    "Support Boundary",
    "gemstone-js-doctor --live",
  ],
);
assertSnippets(
  "docs/framework-adapters.md",
  frameworkDocs,
  [
    "examples/web-express.ts",
    "examples/web-fastify.ts",
    "examples/web-fetch.ts",
    "examples/web-hono.ts",
    "transactionPolicy: \"abortOnExit\"",
    "RequestScope",
  ],
);
assertSnippets(
  "docs/doctor.md",
  doctorDocs,
  [
    "gemstone-js-doctor",
    "gemstone-js-doctor --json",
    "gemstone-js-doctor --live",
    "does not print passwords",
    "GS_NETLDI_NAME_OR_PORT",
    "GS_NATIVE_SESSION_WORKER",
    "createGciSessionWorker",
    "GciSessionWorker",
    "method surface",
    "canonical value",
  ],
);
assertSnippets(
  "docs/examples-guide.md",
  examplesGuideDocs,
  [
    "gemstone-js-examples --plans",
    "gemstone-js-examples --plan first-session",
    "gemstone-js-examples --commands --plan data-persistence",
    "npm run examples:check",
    "npm run live:check",
    "npm run test:live:worker",
    "examples/web-route-handler.ts",
    "GS_NETLDI_NAME_OR_PORT",
    "GS_NATIVE_SESSION_WORKER",
  ],
);
assertSnippets(
  "docs/gemstone-js-vs-gemstone-py.md",
  jsComparisonDocs,
  [
    "gemstone-js vs gemstone-py",
    "gemstone-js-compare gemstone-js --scorecard",
    "gemstone-js-compare --target gemstone-js --view scorecard",
    "--scope beta --view totals",
    "--assert-total-batches 6 --assert-hours-max 72",
    "--assert-total-batches 1 --assert-hours-max 8",
    "--max-total-batches 6 --max-hours-max 72 --quiet",
    "--max-total-batches 1 --max-hours-max 8 --quiet",
    "--format markdown --output comparison-report.md",
    "--output comparison-report.json",
    "6 batches",
    "42-72 hours",
    "remaining validation batch",
    "4-8 hours",
    "Native publish confidence",
    "docs/gemstone-py-parity.md",
  ],
);
assertSnippets(
  "docs/gemstone-py-parity.md",
  parityDocs,
  [
    "Current Comparison",
    "Still Python-Only",
    "Remaining Work Estimate",
    "one focused validation batch",
    "--scope beta",
    "bulkPerformCallsOop()",
    "bulkPerformCallsWithOop()",
    "bulkPerformCallsObjectsWith()",
    "native session-thread model",
    "native prebuild artifact verification",
    "VS Code workbench",
    "gemstone-js-compare",
  ],
);
assertSnippets(
  "docs/gemstone-rs-comparison.md",
  rustComparisonDocs,
  [
    "gemstone-rs vs gemstone-py",
    "6 batches",
    "44-79 hours",
    "Shared core with gemstone-py-native",
    "gemstone-js-compare gemstone-rs --batches",
    "gemstone-js-compare --target gemstone-rs --view scorecard",
    "--scope beta --view totals",
    "--assert-total-batches 6 --assert-hours-max 79",
    "--assert-total-batches 4 --assert-hours-max 45",
    "--max-total-batches 6 --max-hours-max 79 --quiet",
    "--max-total-batches 4 --max-hours-max 45 --quiet",
    "--format markdown --output gemstone-rs-comparison.md",
    "--output gemstone-rs-comparison.json",
    "12 batches",
    "26-45 hours",
  ],
);
assertSnippets(
  "docs/releasing.md",
  releasingDocs,
  [
    "npm run verify",
    "npm run public-surface:check",
    "npm run release:check",
    "npm run provenance:check",
    "npm run native-install:check",
    "npm run release-candidate:check -- --skip-live",
    "npm run ci-artifact:review -- --dir .",
    "gh run download",
    "gemstone-js-package-node-24",
    "npm run api-contract:installed",
    "gemstone-js-api-contract --json",
    "npm view gemstone-js@$VERSION dist.integrity dist.signatures --json",
    "node scripts/verify-provenance-metadata.mjs npm-provenance.json",
    "npm audit signatures",
    "npm publish --access public --tag alpha --provenance",
    "dist.integrity",
    "dist.signatures",
    "SHA256SUMS.txt",
    "scripts/check-release-artifacts.mjs",
    "node scripts/verify-checksums.mjs SHA256SUMS.txt",
    "shasum -a 256 -c SHA256SUMS.txt",
    "@gemstone-js/native",
    "createGciSessionWorker",
    "GS_NATIVE_SESSION_WORKER=1",
  ],
);

if (!publicSurfaceCheck.includes("ts.createSourceFile") || !publicSurfaceCheck.includes("specifier.isTypeOnly")) {
  throw new Error("scripts/check-public-surface.mjs must parse the public barrel with the TypeScript compiler API.");
}
if (
  !publicSurfaceCheck.includes("Public surface check passed")
  || !publicSurfaceCheck.includes("Run npm run public-surface:write")
) {
  throw new Error("scripts/check-public-surface.mjs must report stable checks and regeneration guidance.");
}
for (const exportName of ["Session", "SessionPool", "RequestScope", "GemStoneError", "SESSION_ENV_ALIAS_GROUPS", "sessionConfigFromEnv", "sessionEnvAliasConflicts"]) {
  if (!publicSurfaceContract.values?.some((entry) => entry.name === exportName)) {
    throw new Error(`scripts/public-surface.expected.json is missing value export: ${exportName}`);
  }
}
for (const exportName of ["SessionConfig", "SessionEnv", "SessionEnvAliasConflict", "SessionEnvAliasField", "GciRuntime", "TransactionPolicy", "ValueConverterOptions", "PerformCall", "PerformCallInput", "PerformWithCall", "PerformWithCallInput", "GemStoneOopHandle", "DictionaryReadbackOptions", "KeyedReadbackOptions", "GStoreReadOptions", "ObjectLogReadOptions", "ObjectLogFormatOptions", "ObjectLogSummary"]) {
  if (!publicSurfaceContract.types?.some((entry) => entry.name === exportName)) {
    throw new Error(`scripts/public-surface.expected.json is missing type export: ${exportName}`);
  }
}
if (!apiContract.includes("await import(moduleSpecifier)") || !apiContract.includes("missingValueExports")) {
  throw new Error("scripts/api-contract.mjs must import and compare runtime value exports.");
}
for (const name of ["quickstart", "gstore", "persistent-root", "query", "bulk-perform", "migrations", "object-log", "web-express", "web-fetch", "web-route-handler"]) {
  if (!examplesCatalog.includes(name)) {
    throw new Error(`scripts/examples-catalog.mjs must include packaged example: ${name}.`);
  }
}
if (
  !examplesCli.includes("--show")
  || !examplesCli.includes("--path")
  || !examplesCli.includes("--kind")
  || !examplesCli.includes("--commands")
  || !examplesCli.includes("--plans")
  || !examplesCli.includes("--plan")
  || !examplesCli.includes("examplePlans")
) {
  throw new Error("scripts/examples.mjs must list, filter, show, and print runnable commands and guided plans.");
}
if (
  !examplesCheck.includes("--experimental-strip-types")
  || !examplesCheck.includes("exampleCatalog")
  || !examplesCheck.includes("examplePlans")
  || !examplesCheck.includes("JSON.parse")
  || !examplesCheck.includes("invalid command")
  || !examplesCheck.includes("unknown example")
  || !examplesCheck.includes("missing from scripts/examples-catalog.mjs")
) {
  throw new Error("scripts/check-examples.mjs must syntax-check TypeScript examples, parse JSON examples, validate command/plan metadata, and require catalog coverage.");
}
if (
  !apiContract.includes("--json")
  || !apiContract.includes("typeExportsInContract")
  || !apiContract.includes("REQUIRED_BIN_ENTRIES")
  || !apiContract.includes("gemstone-js-doctor")
  || !apiContract.includes("gemstone-js-compare")
  || !apiContract.includes("./schemas/comparison-report.schema.json")
  || !apiContract.includes("REQUIRED_SCHEMA_EXPORTS")
) {
  throw new Error("scripts/api-contract.mjs must support JSON reports with source, bin, and schema export counts.");
}
if (
  !compareCli.includes("gemstone-rs vs gemstone-py")
  || !compareCli.includes("gemstone-js vs gemstone-py")
  || !compareCli.includes("docs/gemstone-js-vs-gemstone-py.md")
  || !compareCli.includes("COMPARISON_REPORT_SCHEMA_VERSION")
  || !compareCli.includes("COMPARISON_REPORT_SCHEMA_PATH")
  || !compareCli.includes("formatMarkdownReport")
  || !compareCli.includes("--markdown")
  || !compareCli.includes("--format <format>")
  || !compareCli.includes("--target <target>")
  || !compareCli.includes("--view <view>")
  || !compareCli.includes("--scope <scope>")
  || !compareCli.includes("--beta")
  || !compareCli.includes("betaBatches")
  || !compareCli.includes("--assert-total-batches")
  || !compareCli.includes("--assert-hours-min")
  || !compareCli.includes("--assert-hours-max")
  || !compareCli.includes("--max-total-batches")
  || !compareCli.includes("--max-hours-min")
  || !compareCli.includes("--max-hours-max")
  || !compareCli.includes("--quiet")
  || !compareCli.includes("assertReportBounds")
  || !compareCli.includes("parseTarget")
  || !compareCli.includes("parseView")
  || !compareCli.includes("parseScope")
  || !compareCli.includes("--output")
  || !compareCli.includes("writeFileSync")
  || !compareCli.includes("totalBatches")
  || !compareCli.includes("Shared core with gemstone-py-native")
  || !compareCli.includes("Native publish confidence")
  || !compareCli.includes("--batches")
  || !compareCli.includes("--json")
) {
  throw new Error("scripts/compare.mjs must report JS/Rust comparisons, batch totals, batch plans, and JSON output.");
}
if (
  !comparisonCheck.includes("TARGETS")
  || !comparisonCheck.includes("VIEWS")
  || !comparisonCheck.includes("SCOPES")
  || !comparisonCheck.includes("EXPECTED_TOTALS")
  || !comparisonCheck.includes("fullGuide does not exist")
  || !comparisonCheck.includes("scope")
  || !comparisonCheck.includes("explicit --target report comparison")
  || !comparisonCheck.includes("explicit --view report view")
  || !comparisonCheck.includes("explicit --scope report scope")
  || !comparisonCheck.includes("assertAssertionFailure")
  || !comparisonCheck.includes("assertQuietThresholdCheck")
  || !comparisonCheck.includes("--assert-total-batches")
  || !comparisonCheck.includes("--max-total-batches")
  || !comparisonCheck.includes("maximum threshold failed")
  || !comparisonCheck.includes("assertOutputWrite")
  || !comparisonCheck.includes("written JSON report")
  || !comparisonCheck.includes("Markdown comparison output")
  || !comparisonCheck.includes("written Markdown comparison report")
  || !comparisonCheck.includes("42-72 hours")
  || !comparisonCheck.includes("4-8 hours")
  || !comparisonCheck.includes("86-151 hours")
  || !comparisonCheck.includes("Comparison report check passed")
) {
  throw new Error("scripts/check-comparison-reports.mjs must validate all comparison report targets, views, schema metadata, and expected totals.");
}
if (
  comparisonSchema.properties?.schema_version?.const !== 1
  || comparisonSchema.properties?.$schema?.const !== "./schemas/comparison-report.schema.json"
  || !comparisonSchema.properties?.scope?.enum?.includes("full")
  || !comparisonSchema.properties?.scope?.enum?.includes("beta")
  || !comparisonSchema.properties?.comparison?.enum?.includes("gemstone-js")
  || !comparisonSchema.properties?.comparison?.enum?.includes("gemstone-rs")
  || !comparisonSchema.properties?.comparison?.enum?.includes("all")
  || !comparisonSchema.properties?.view?.enum?.includes("batches")
  || !comparisonSchema.$defs?.batch
  || !comparisonSchema.$defs?.gap
) {
  throw new Error("schemas/comparison-report.schema.json must describe versioned comparison reports, views, batches, and gaps.");
}
if (
  !installedApiContractCheck.includes("--pack-destination")
  || !installedApiContractCheck.includes("--strip-components")
  || !installedApiContractCheck.includes("scripts\", \"api-contract.mjs")
  || !installedApiContractCheck.includes("scripts/check-comparison-reports.mjs")
  || !installedApiContractCheck.includes("scripts\", \"compare.mjs")
  || !installedApiContractCheck.includes("scripts\", \"doctor.mjs")
  || !installedApiContractCheck.includes("scripts/verify-provenance-metadata.mjs")
  || !installedApiContractCheck.includes("scripts/check-release-artifacts.mjs")
  || !installedApiContractCheck.includes("schemas/comparison-report.schema.json")
  || !installedApiContractCheck.includes("gemstone-js/testing")
  || !installedApiContractCheck.includes("gemstone-js/adapters")
  || !installedApiContractCheck.includes("gemstone-js/adapters/express")
  || !installedApiContractCheck.includes("gemstone-js/adapters/fetch")
  || !installedApiContractCheck.includes("gemstone-js/adapters/fastify")
  || !installedApiContractCheck.includes("gemstone-js/adapters/hono")
  || !installedApiContractCheck.includes("MockGciRuntime")
  || !installedApiContractCheck.includes("assertInstalledTypeConsumer")
  || !installedApiContractCheck.includes("consumer.ts")
  || !installedApiContractCheck.includes("RuntimeName")
  || !installedApiContractCheck.includes("node_modules/typescript/bin/tsc")
  || !installedApiContractCheck.includes("web-fetch")
  || !installedApiContractCheck.includes("assertInstalledBins")
  || !installedApiContractCheck.includes("assertInstalledBinHelp")
  || !installedApiContractCheck.includes("\"--help\"")
  || !installedApiContractCheck.includes("Node shebang")
) {
  throw new Error("scripts/check-installed-api-contract.mjs must pack, extract, and validate installed API contract, release helpers, adapter subpaths, examples, and CLI bins.");
}
if (
  !nativeInstallCheck.includes("gemstone-js-native")
  || !nativeInstallCheck.includes("npm\", [")
  || !nativeInstallCheck.includes("install")
  || !nativeInstallCheck.includes("assertPackMetadata")
  || !nativeInstallCheck.includes("assertNativeVersionParity")
  || !nativeInstallCheck.includes("assertNativeTarballContents")
  || !nativeInstallCheck.includes("assertInstalledPackageGraph")
  || !nativeInstallCheck.includes("optionalDependencies")
  || !nativeInstallCheck.includes("sha512-")
  || !nativeInstallCheck.includes(".node")
  || !nativeInstallCheck.includes("npm\", [\"ls\"")
  || !nativeInstallCheck.includes("createGciSessionWorker")
  || !nativeInstallCheck.includes("node_modules")
  || !nativeInstallCheck.includes("doctor.mjs")
  || !nativeInstallCheck.includes("sessionWorkerAvailable")
  || !nativeInstallCheck.includes("sessionWorkerSurfaceComplete")
  || !nativeInstallCheck.includes("assertNativeTypeConsumer")
  || !nativeInstallCheck.includes("assertInstalledLiveWorkerSmoke")
  || !nativeInstallCheck.includes("GS_RUN_LIVE")
  || !nativeInstallCheck.includes("native-consumer.ts")
  || !nativeInstallCheck.includes("GemStoneNativeError")
) {
  throw new Error("scripts/check-native-install.mjs must pack both packages, validate native package metadata/artifacts, install them together, and verify native worker plus installed CLI behavior.");
}
if (
  !releaseArtifactCheck.includes("--pack-destination")
  || !releaseArtifactCheck.includes("write-checksums.mjs")
  || !releaseArtifactCheck.includes("verify-checksums.mjs")
  || !releaseArtifactCheck.includes("SHA256SUMS.txt")
  || !releaseArtifactCheck.includes("assertChecksumTargets")
  || !releaseArtifactCheck.includes("assertTarballContents")
  || !releaseArtifactCheck.includes("assertPackageTargetEntries")
  || !releaseArtifactCheck.includes("collectExportTargets")
  || !releaseArtifactCheck.includes("Release tarball bin")
  || !releaseArtifactCheck.includes("package/dist/index.js")
  || !releaseArtifactCheck.includes("package/dist/index.d.ts")
  || !releaseArtifactCheck.includes("package/src/index.ts")
  || !releaseArtifactCheck.includes("package/scripts/check-native-install.mjs")
  || !releaseArtifactCheck.includes("package/scripts/check-release-artifacts.mjs")
  || !releaseArtifactCheck.includes("package/scripts/review-ci-artifact.mjs")
) {
  throw new Error("scripts/check-release-artifacts.mjs must pack to a temporary directory, verify checksums, and inspect release tarball contents.");
}
if (
  !ciArtifactReview.includes("SHA256SUMS.txt")
  || !ciArtifactReview.includes("verify-checksums.mjs")
  || !ciArtifactReview.includes("package/scripts/check-release-candidate.mjs")
  || !ciArtifactReview.includes("package/scripts/review-ci-artifact.mjs")
  || !ciArtifactReview.includes("publishConfig")
  || !ciArtifactReview.includes("optionalDependencies")
  || !ciArtifactReview.includes("package main")
  || !ciArtifactReview.includes("CI artifact review passed")
) {
  throw new Error("scripts/review-ci-artifact.mjs must verify downloaded CI tarball artifacts, checksums, metadata, and package entry targets.");
}
if (
  !provenanceVerifier.includes("dist.integrity")
  || !provenanceVerifier.includes("dist.signatures")
  || !provenanceVerifier.includes("SRI sha digest")
  || !provenanceVerifier.includes("keyid")
  || !provenanceVerifier.includes("sig")
  || !provenanceVerifier.includes("--self-test")
  || !provenanceVerifier.includes("npm view <package>@<version>")
) {
  throw new Error("scripts/verify-provenance-metadata.mjs must validate saved npm provenance metadata and include a self-test.");
}
assertSnippets(
  "scripts/check-live-smoke.mjs",
  liveSmokeCheck,
  [
    "GS_RUN_LIVE",
    "tests/live.test.ts",
    "tests/fixtures/live-codegen.manifest.json",
    "tests/fixtures/live-codegen.generated.ts",
    "Session.connect(Session.configFromEnv())",
    "generatedObjectPrintString(session)",
    "generatedObjectClassOop(session)",
    "generatedNewObject(session)",
    "session.bulkPerformOop",
    "session.bulkPerformObjects",
    "session.bulkPerformValueWith",
    "session.arrayValues",
    "session.dictionaryItemsOop",
    "session.dictionaryEntries(dict.oop, { maxEntries: 2 })",
    "dict.keys({ maxEntries: 2 })",
    "session.globalKeys({ maxEntries: liveGlobalKeys.length })",
    "session.globalItemsOop",
    "session.globalValuesOop",
    "new PersistentRoot(session)",
    "root.keys({ maxEntries: liveRootKeys.length })",
    "GStore.open",
    "gstore.read({ maxEntries: 2 })",
    "GStore.list(session, { maxEntries: liveGStoreNames.length })",
    "new GSCollection(session",
    "query.limit(",
    "query.createIndex(",
    "largeQuery.count",
    "largeQuery.limit",
    "largeQuery.pageOop",
    "upgrade(session",
    "pool.acquire(1_000)",
    "acquire_queued",
    "gemstoneFetch",
    "gemstoneExpress",
    "gemstoneFastify",
    "gemstoneHono",
    "LiveFakeExpressResponse",
    "LiveFakeHonoContext",
    "nativeSessionWorker: true",
    "session.runtime.name",
    "session.runtime.fetchBytes",
    "session.runtime.fetchBytes(workerText, 0, 1)",
    "GemStone live smoke check passed",
  ],
);
assertSnippets(
  "src/session-env.ts",
  sessionEnvSource,
  [
    "SESSION_ENV_ALIAS_GROUPS",
    "SessionEnvAliasConflict",
    "sessionEnvAliasConflicts",
    "GS_USER",
    "GS_PASS",
    "GS_NETLDI_HOST",
    "GS_NETLDI_NAME_OR_PORT",
    "GS_SERVICE",
    "GS_NATIVE_SESSION_WORKER",
    "nativeSessionWorker",
  ],
);
assertSnippets(
  "src/doctor.ts",
  doctorSource,
  [
    "environmentAliasConflictChecks",
    "canonical values win",
    "details: { conflicts }",
    "REQUIRED_NATIVE_SESSION_WORKER_METHODS",
    "missingNativeSessionWorkerMethods",
    "sessionWorkerSurfaceComplete",
    "missingWorkerMethods",
    "createGciSessionWorker",
    "sessionWorkerAvailable",
  ],
);
assertSnippets(
  "src/runtime/node.ts",
  nodeRuntimeSource,
  [
    "REQUIRED_SESSION_WORKER_METHODS",
    "missingNativeTargetMethods",
    "GciSessionWorker is missing required methods",
    "await closeNativeTarget(worker).catch(() => undefined)",
    "strictTarget: useSessionWorker",
    "GciSessionWorker",
  ],
);
assertSnippets(
  "tests/runtime-ffi.test.ts",
  runtimeFfiTests,
  [
    "completeNativeWorker",
    "Node runtime validates worker surface before dispatch",
    "GciSessionWorker is missing required methods: fetchBytes",
    "raw:fetchBytes",
    "incomplete worker target should be closed after failed validation",
    "Node runtime preserves module fallback receiver for raw native layouts",
  ],
);

if (!checksumCheck.includes("write-checksums.mjs")) {
  throw new Error("scripts/check-checksums.mjs must exercise write-checksums.mjs.");
}
if (!checksumCheck.includes("SHA256SUMS.txt") || !checksumCheck.includes("no files match")) {
  throw new Error("scripts/check-checksums.mjs must assert checksum output and no-match behavior.");
}
if (!checksumCheck.includes("assertInvalidSuffixFails")) {
  throw new Error("scripts/check-checksums.mjs must assert invalid checksum suffix behavior.");
}
if (!checksumCheck.includes("assertDuplicateSuffixFails")) {
  throw new Error("scripts/check-checksums.mjs must assert duplicate checksum suffix behavior.");
}
if (!checksumCheck.includes("assertManifestIsExcluded")) {
  throw new Error("scripts/check-checksums.mjs must assert SHA256SUMS.txt exclusion behavior.");
}
if (
  !checksumCheck.includes("verify-checksums.mjs")
  || !checksumCheck.includes("assertMismatchFails")
  || !checksumCheck.includes("assertVerifierInputFailures")
) {
  throw new Error("scripts/check-checksums.mjs must assert checksum verification and mismatch behavior.");
}
if (!checksumWriter.includes("createHash") || !checksumWriter.includes("sha256")) {
  throw new Error("scripts/write-checksums.mjs must compute sha256 digests.");
}
if (!checksumWriter.includes("startsWith(\".\")")) {
  throw new Error("scripts/write-checksums.mjs must validate artifact suffix filters.");
}
if (!checksumWriter.includes("path separators")) {
  throw new Error("scripts/write-checksums.mjs must reject pathful artifact suffix filters.");
}
if (!checksumWriter.includes("without whitespace")) {
  throw new Error("scripts/write-checksums.mjs must reject whitespace-bearing artifact suffix filters.");
}
if (!checksumWriter.includes("uniqueSuffixes")) {
  throw new Error("scripts/write-checksums.mjs must reject duplicate artifact suffix filters.");
}
if (!checksumWriter.includes('file !== "SHA256SUMS.txt"')) {
  throw new Error("scripts/write-checksums.mjs must exclude SHA256SUMS.txt from artifact targets.");
}
if (!checksumWriter.includes("isFile()")) {
  throw new Error("scripts/write-checksums.mjs must only write checksums for regular files.");
}
if (!checksumWriter.includes("artifact file names must not contain whitespace")) {
  throw new Error("scripts/write-checksums.mjs must reject whitespace-bearing artifact file names.");
}
if (!checksumWriter.includes("portable ASCII characters")) {
  throw new Error("scripts/write-checksums.mjs must reject non-portable artifact file names.");
}
if (!checksumVerifier.includes("createHash") || !checksumVerifier.includes("Checksum mismatch")) {
  throw new Error("scripts/verify-checksums.mjs must verify sha256 digests and report mismatches.");
}
if (!checksumVerifier.includes("Duplicate checksum target")) {
  throw new Error("scripts/verify-checksums.mjs must reject duplicate checksum entries.");
}
if (!checksumVerifier.includes("must not be artifact targets")) {
  throw new Error("scripts/verify-checksums.mjs must reject checksum manifest artifact targets.");
}
if (!checksumVerifier.includes("regular files")) {
  throw new Error("scripts/verify-checksums.mjs must reject non-file checksum targets.");
}
if (!checksumVerifier.includes("file entries must not contain whitespace")) {
  throw new Error("scripts/verify-checksums.mjs must reject whitespace-bearing checksum targets.");
}
if (!checksumVerifier.includes("portable ASCII basenames")) {
  throw new Error("scripts/verify-checksums.mjs must reject non-portable checksum targets.");
}

for (const path of forbidden) {
  const included = files.find((file) => file === path || file.startsWith(`${path}/`) || file.endsWith(`/${path}`));
  if (included) {
    throw new Error(`npm pack unexpectedly includes: ${included}`);
  }
}

console.log(`Package check passed: ${pack.name}@${pack.version} (${files.length} files).`);

function runRequiredCheck(label, args) {
  try {
    execFileSync(process.execPath, args, { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout ?? "") : "";
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    const details = [stdout, stderr].map((text) => text.trim()).filter(Boolean).join("\n");
    throw new Error(`${label} check failed.${details ? `\n${details}` : ""}`);
  }
}

function assertSnippets(path, contents, snippets) {
  for (const snippet of snippets) {
    if (!contents.includes(snippet)) {
      throw new Error(`${path} is missing required release verification snippet: ${JSON.stringify(snippet)}.`);
    }
  }
}

function assertDistDeclarationsUseJs(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      assertDistDeclarationsUseJs(path);
    } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      const contents = readFileSync(path, "utf8");
      if (/["'][^"']+\.ts["']/.test(contents)) {
        throw new Error(`${path} must not reference .ts modules; dist declarations should use .js specifiers.`);
      }
    }
  }
}
