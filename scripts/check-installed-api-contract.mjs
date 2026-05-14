#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  const fetchAdapter = await import("gemstone-js/adapters/fetch");
  if (typeof fetchAdapter.gemstoneFetch !== "function" || typeof fetchAdapter.withGemStoneFetch !== "function") {
    throw new Error("Installed Fetch adapter subpath must export gemstoneFetch and withGemStoneFetch.");
  }

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
