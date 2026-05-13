import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

const required = [
  "LICENSE",
  "README.md",
  "docs/architecture.md",
  "examples/codegen.manifest.json",
  "examples/quickstart.ts",
  "package.json",
  "scripts/check-package.mjs",
  "scripts/codegen.mjs",
  "src/index.ts",
  "src/client.ts",
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

for (const path of forbidden) {
  const included = files.find((file) => file === path || file.startsWith(`${path}/`) || file.endsWith(`/${path}`));
  if (included) {
    throw new Error(`npm pack unexpectedly includes: ${included}`);
  }
}

console.log(`Package check passed: ${pack.name}@${pack.version} (${files.length} files).`);
