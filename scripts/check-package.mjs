import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const nativeDeclaration = readFileSync("src/native-module.d.ts", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const frameworkDocs = readFileSync("docs/framework-adapters.md", "utf8");
const examplesGuideDocs = readFileSync("docs/examples-guide.md", "utf8");
const releasingDocs = readFileSync("docs/releasing.md", "utf8");
const checksumCheck = readFileSync("scripts/check-checksums.mjs", "utf8");
const checksumWriter = readFileSync("scripts/write-checksums.mjs", "utf8");
const checksumVerifier = readFileSync("scripts/verify-checksums.mjs", "utf8");
const apiContract = readFileSync("scripts/api-contract.mjs", "utf8");
const examplesCatalog = readFileSync("scripts/examples-catalog.mjs", "utf8");
const examplesCli = readFileSync("scripts/examples.mjs", "utf8");
const examplesCheck = readFileSync("scripts/check-examples.mjs", "utf8");
const installedApiContractCheck = readFileSync("scripts/check-installed-api-contract.mjs", "utf8");
const publicSurfaceCheck = readFileSync("scripts/check-public-surface.mjs", "utf8");
const publicSurfaceContract = JSON.parse(readFileSync("scripts/public-surface.expected.json", "utf8"));

if (packageJson.publishConfig?.provenance !== true) {
  throw new Error("package.json publishConfig.provenance must be true.");
}
for (const schemaExport of [
  "./schemas/codegen-manifest.schema.json",
  "./schemas/benchmark-report.schema.json",
  "./schemas/benchmark-baseline-manifest.schema.json",
]) {
  if (packageJson.exports?.[schemaExport] !== schemaExport) {
    throw new Error(`package.json must export ${schemaExport}.`);
  }
}
for (const [name, target] of Object.entries({
  "./adapters": "./src/adapters/index.ts",
  "./adapters/express": "./src/adapters/express.ts",
  "./adapters/fastify": "./src/adapters/fastify.ts",
  "./adapters/fetch": "./src/adapters/fetch.ts",
  "./adapters/hono": "./src/adapters/hono.ts",
})) {
  const entry = packageJson.exports?.[name];
  if (entry?.types !== target || entry?.import !== target) {
    throw new Error(`package.json must export ${name} import/types at ${target}.`);
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
  "codegen:check": "node scripts/codegen.mjs --check examples/codegen.manifest.json examples/codegen.generated.ts",
  "codegen:scan:check": "node scripts/scan-codegen.mjs --module --check --out examples/booking.decorators.generated.ts examples/booking.decorators.ts",
  "examples": "node scripts/examples.mjs",
  "examples:json": "node scripts/examples.mjs --json",
  "examples:check": "node scripts/check-examples.mjs",
  "inspect": "node scripts/inspect.mjs",
  "migrations": "node scripts/migrations.mjs",
  "public-surface:check": "node scripts/check-public-surface.mjs",
  "public-surface:write": "node scripts/check-public-surface.mjs --write",
  "checksum:check": "node scripts/check-checksums.mjs",
  "checksum:verify": "node scripts/verify-checksums.mjs",
  "pack:check": "node scripts/check-package.mjs",
  "verify": "npm run typecheck && npm run codegen:check && npm run codegen:scan:check && npm run examples:check && npm run public-surface:check && npm run api-contract && npm test && npm run checksum:check && npm run pack:check && npm run api-contract:installed",
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
runRequiredCheck("codegen manifest output", ["scripts/codegen.mjs", "--check", "examples/codegen.manifest.json", "examples/codegen.generated.ts"]);
runRequiredCheck("decorated-source codegen output", [
  "scripts/scan-codegen.mjs",
  "--module",
  "--check",
  "--out",
  "examples/booking.decorators.generated.ts",
  "examples/booking.decorators.ts",
]);
runRequiredCheck("example syntax", ["scripts/check-examples.mjs"]);
runRequiredCheck("example catalog kind filter", ["scripts/examples.mjs", "--kind", "data"]);
runRequiredCheck("example catalog JSON kind filter", ["scripts/examples.mjs", "--json", "--kind", "ops"]);
runRequiredCheck("example catalog command list", ["scripts/examples.mjs", "--commands", "--kind", "web"]);
runRequiredCheck("example plan list", ["scripts/examples.mjs", "--plans"]);
runRequiredCheck("example plan details", ["scripts/examples.mjs", "--plan", "data-persistence"]);
runRequiredCheck("example plan commands", ["scripts/examples.mjs", "--commands", "--plan", "web-service"]);
runRequiredCheck("public surface contract", ["scripts/check-public-surface.mjs"]);
runRequiredCheck("runtime API contract", ["scripts/api-contract.mjs"]);

const required = [
  "LICENSE",
  "README.md",
  "docs/architecture.md",
  "docs/benchmarks.md",
  "docs/examples-guide.md",
  "docs/framework-adapters.md",
  "docs/gemstone-py-parity.md",
  "docs/migrations.md",
  "docs/naming.md",
  "docs/releasing.md",
  "examples/booking.decorators.generated.ts",
  "examples/booking.decorators.ts",
  "examples/booking.ts",
  "examples/codegen.generated.ts",
  "examples/codegen.manifest.json",
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
  "scripts/api-contract.mjs",
  "scripts/benchmark-baselines.mjs",
  "scripts/benchmark-compare.mjs",
  "scripts/benchmark-register.mjs",
  "scripts/benchmark-validate.mjs",
  "scripts/benchmarks.mjs",
  "scripts/bootstrap.mjs",
  "scripts/check-checksums.mjs",
  "scripts/check-examples.mjs",
  "scripts/check-installed-api-contract.mjs",
  "scripts/check-package.mjs",
  "scripts/check-public-surface.mjs",
  "scripts/codegen.mjs",
  "scripts/examples-catalog.mjs",
  "scripts/examples.mjs",
  "scripts/inspect.mjs",
  "scripts/migrations.mjs",
  "scripts/public-surface.expected.json",
  "scripts/scan-codegen.mjs",
  "scripts/verify-checksums.mjs",
  "scripts/write-checksums.mjs",
  "src/index.ts",
  "src/benchmark-baselines.ts",
  "src/benchmarks.ts",
  "src/bootstrap.ts",
  "src/client.ts",
  "src/gstore.ts",
  "src/inspection-cli.ts",
  "src/migrations.ts",
  "src/object-log.ts",
  "src/reduced-conflict.ts",
  "src/smalltalk-source.ts",
  "src/runtime/node.ts",
  "src/runtime/library-discovery.ts",
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
for (const snippet of ["category: string", "context: string", "exceptionObj: string", "args: string[]"]) {
  if (!nativeDeclaration.includes(snippet)) {
    throw new Error(`src/native-module.d.ts is missing native GciErrorInfo field: ${snippet}`);
  }
}
assertSnippets(
  ".github/workflows/ci.yml",
  ciWorkflow,
  [
    "npm run verify",
    "npm pack --json",
    "node scripts/write-checksums.mjs .tgz",
    "node scripts/verify-checksums.mjs SHA256SUMS.txt",
    "SHA256SUMS.txt",
    "actions/upload-artifact@v4",
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
  "docs/examples-guide.md",
  examplesGuideDocs,
  [
    "gemstone-js-examples --plans",
    "gemstone-js-examples --plan first-session",
    "gemstone-js-examples --commands --plan data-persistence",
    "npm run examples:check",
    "examples/web-route-handler.ts",
  ],
);
assertSnippets(
  "docs/releasing.md",
  releasingDocs,
  [
    "npm run verify",
    "npm run public-surface:check",
    "npm run api-contract:installed",
    "gemstone-js-api-contract --json",
    "SHA256SUMS.txt",
    "node scripts/verify-checksums.mjs SHA256SUMS.txt",
    "shasum -a 256 -c SHA256SUMS.txt",
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
for (const exportName of ["Session", "SessionPool", "RequestScope", "GemStoneError"]) {
  if (!publicSurfaceContract.values?.some((entry) => entry.name === exportName)) {
    throw new Error(`scripts/public-surface.expected.json is missing value export: ${exportName}`);
  }
}
for (const exportName of ["SessionConfig", "GciRuntime", "TransactionPolicy", "ValueConverterOptions"]) {
  if (!publicSurfaceContract.types?.some((entry) => entry.name === exportName)) {
    throw new Error(`scripts/public-surface.expected.json is missing type export: ${exportName}`);
  }
}
if (!apiContract.includes("await import(moduleSpecifier)") || !apiContract.includes("missingValueExports")) {
  throw new Error("scripts/api-contract.mjs must import and compare runtime value exports.");
}
for (const name of ["quickstart", "gstore", "persistent-root", "query", "migrations", "object-log", "web-express", "web-fetch", "web-route-handler"]) {
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
  || !apiContract.includes("REQUIRED_SCHEMA_EXPORTS")
) {
  throw new Error("scripts/api-contract.mjs must support JSON reports with source, bin, and schema export counts.");
}
if (
  !installedApiContractCheck.includes("--pack-destination")
  || !installedApiContractCheck.includes("--strip-components")
  || !installedApiContractCheck.includes("scripts\", \"api-contract.mjs")
  || !installedApiContractCheck.includes("gemstone-js/adapters/fetch")
  || !installedApiContractCheck.includes("web-fetch")
  || !installedApiContractCheck.includes("assertInstalledBins")
  || !installedApiContractCheck.includes("Node shebang")
) {
  throw new Error("scripts/check-installed-api-contract.mjs must pack, extract, and validate installed API contract, adapter subpaths, examples, and CLI bins.");
}

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
