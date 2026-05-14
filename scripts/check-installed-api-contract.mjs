#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

  console.log(
    `Installed API contract check passed: ${report.packageName}@${report.version} (${report.actualValueExports} runtime value exports).`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
