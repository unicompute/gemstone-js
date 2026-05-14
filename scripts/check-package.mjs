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
const releasingDocs = readFileSync("docs/releasing.md", "utf8");
const checksumCheck = readFileSync("scripts/check-checksums.mjs", "utf8");
const checksumWriter = readFileSync("scripts/write-checksums.mjs", "utf8");
const checksumVerifier = readFileSync("scripts/verify-checksums.mjs", "utf8");

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
const requiredScripts = {
  "benchmark:baselines": "node scripts/benchmark-baselines.mjs",
  "benchmark:compare": "node scripts/benchmark-compare.mjs",
  "benchmark:register": "node scripts/benchmark-register.mjs",
  "benchmark:validate": "node scripts/benchmark-validate.mjs",
  "benchmarks": "node scripts/benchmarks.mjs",
  "bootstrap": "node scripts/bootstrap.mjs",
  "codegen:check": "node scripts/codegen.mjs --check examples/codegen.manifest.json examples/codegen.generated.ts",
  "codegen:scan:check": "node scripts/scan-codegen.mjs --module --check --out examples/booking.decorators.generated.ts examples/booking.decorators.ts",
  "inspect": "node scripts/inspect.mjs",
  "migrations": "node scripts/migrations.mjs",
  "checksum:check": "node scripts/check-checksums.mjs",
  "checksum:verify": "node scripts/verify-checksums.mjs",
  "pack:check": "node scripts/check-package.mjs",
  "verify": "npm run typecheck && npm run codegen:check && npm run codegen:scan:check && npm test && npm run checksum:check && npm run pack:check",
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

const required = [
  "LICENSE",
  "README.md",
  "docs/architecture.md",
  "docs/benchmarks.md",
  "docs/gemstone-py-parity.md",
  "docs/migrations.md",
  "docs/naming.md",
  "docs/releasing.md",
  "examples/booking.decorators.generated.ts",
  "examples/booking.decorators.ts",
  "examples/booking.ts",
  "examples/codegen.generated.ts",
  "examples/codegen.manifest.json",
  "examples/quickstart.ts",
  "package.json",
  "schemas/benchmark-baseline-manifest.schema.json",
  "schemas/benchmark-report.schema.json",
  "schemas/codegen-manifest.schema.json",
  "scripts/benchmark-baselines.mjs",
  "scripts/benchmark-compare.mjs",
  "scripts/benchmark-register.mjs",
  "scripts/benchmark-validate.mjs",
  "scripts/benchmarks.mjs",
  "scripts/bootstrap.mjs",
  "scripts/check-checksums.mjs",
  "scripts/check-package.mjs",
  "scripts/codegen.mjs",
  "scripts/inspect.mjs",
  "scripts/migrations.mjs",
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
  "docs/releasing.md",
  releasingDocs,
  [
    "npm run verify",
    "SHA256SUMS.txt",
    "node scripts/verify-checksums.mjs SHA256SUMS.txt",
    "shasum -a 256 -c SHA256SUMS.txt",
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
