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

if (packageJson.publishConfig?.provenance !== true) {
  throw new Error("package.json publishConfig.provenance must be true.");
}
const requiredScripts = {
  "bootstrap": "node scripts/bootstrap.mjs",
  "codegen:check": "node scripts/codegen.mjs --check examples/codegen.manifest.json examples/codegen.generated.ts",
  "codegen:scan:check": "node scripts/scan-codegen.mjs --module --check --out examples/booking.decorators.generated.ts examples/booking.decorators.ts",
  "inspect": "node scripts/inspect.mjs",
  "migrations": "node scripts/migrations.mjs",
  "pack:check": "node scripts/check-package.mjs",
  "verify": "npm run typecheck && npm run codegen:check && npm run codegen:scan:check && npm test && npm run pack:check",
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
  "schemas/codegen-manifest.schema.json",
  "scripts/bootstrap.mjs",
  "scripts/check-package.mjs",
  "scripts/codegen.mjs",
  "scripts/inspect.mjs",
  "scripts/migrations.mjs",
  "scripts/scan-codegen.mjs",
  "src/index.ts",
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
    "shasum -a 256 -c SHA256SUMS.txt",
  ],
);

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
