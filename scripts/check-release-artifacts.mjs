#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const tempRoot = mkdtempSync(join(tmpdir(), "gemstone-js-release-artifacts-"));
const cache = join(tempRoot, "npm-cache");
const checksumWriter = join(scriptDir, "write-checksums.mjs");
const checksumVerifier = join(scriptDir, "verify-checksums.mjs");

try {
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", tempRoot], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
    stdio: "pipe",
  });
  const [pack] = JSON.parse(packOutput);
  const tarballPath = join(tempRoot, pack.filename);
  if (!existsSync(tarballPath)) {
    throw new Error(`npm pack did not create expected tarball: ${tarballPath}`);
  }

  execFileSync(process.execPath, [checksumWriter, ".tgz"], {
    cwd: tempRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  execFileSync(process.execPath, [checksumVerifier, "SHA256SUMS.txt"], {
    cwd: tempRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  assertChecksumTargets([pack.filename]);
  assertTarballContents(tarballPath);

  console.log(`Release artifact check passed: ${pack.name}@${pack.version} (${pack.filename}).`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function assertChecksumTargets(expected) {
  const actual = readFileSync(join(tempRoot, "SHA256SUMS.txt"), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[a-fA-F0-9]{64}  ([^\r\n]+)$/);
      if (!match) throw new Error(`Invalid checksum line: ${line}`);
      return match[1];
    })
    .sort();
  const expectedSorted = [...expected].sort();
  if (actual.length !== expectedSorted.length || actual.some((target, index) => target !== expectedSorted[index])) {
    throw new Error(`Release checksum targets must be exactly ${expectedSorted.join(", ")}, found: ${actual.join(", ")}`);
  }
}

function assertTarballContents(tarballPath) {
  const entries = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  for (const required of [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/src/index.ts",
    "package/schemas/codegen-manifest.schema.json",
    "package/scripts/api-contract.mjs",
    "package/scripts/check-native-install.mjs",
    "package/scripts/check-release-artifacts.mjs",
    "package/scripts/review-ci-artifact.mjs",
    "package/scripts/verify-checksums.mjs",
    "package/scripts/verify-provenance-metadata.mjs",
    "package/scripts/write-checksums.mjs",
  ]) {
    if (!entries.includes(required)) {
      throw new Error(`Release tarball is missing required entry: ${required}`);
    }
  }
  for (const forbidden of ["package/tests/", "package/node_modules/", "package/.git/"]) {
    if (entries.some((entry) => entry === forbidden || entry.startsWith(forbidden))) {
      throw new Error(`Release tarball unexpectedly includes forbidden entry: ${forbidden}`);
    }
  }
  assertPackageTargetEntries(tarballPath, entries);
}

function assertPackageTargetEntries(tarballPath, entries) {
  const entrySet = new Set(entries);
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const targets = new Map();
  addTarget(targets, "package main", packageJson.main);
  addTarget(targets, "package types", packageJson.types);
  collectExportTargets(targets, packageJson.exports ?? {}, "package exports");
  for (const [name, target] of Object.entries(packageJson.bin ?? {})) {
    addTarget(targets, `package bin ${name}`, target);
  }

  for (const [target, labels] of targets) {
    const entry = `package/${target}`;
    if (!entrySet.has(entry)) {
      throw new Error(`Release tarball is missing ${labels.join(", ")} target: ${entry}`);
    }
  }

  for (const [name, target] of Object.entries(packageJson.bin ?? {})) {
    const entry = `package/${normalizePackageTarget(target)}`;
    const firstLine = readTarEntry(tarballPath, entry).split(/\r?\n/, 1)[0];
    if (firstLine !== "#!/usr/bin/env node") {
      throw new Error(`Release tarball bin ${name} target must have a Node shebang: ${entry}`);
    }
  }
}

function collectExportTargets(targets, value, label) {
  if (typeof value === "string") {
    addTarget(targets, label, value);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    collectExportTargets(targets, child, `${label}.${key}`);
  }
}

function addTarget(targets, label, value) {
  if (typeof value !== "string" || !value.startsWith("./")) return;
  const target = normalizePackageTarget(value);
  const labels = targets.get(target) ?? [];
  labels.push(label);
  targets.set(target, labels);
}

function normalizePackageTarget(value) {
  return value.replace(/^\.\//, "");
}

function readTarEntry(tarballPath, entry) {
  return execFileSync("tar", ["-xOf", tarballPath, entry], {
    encoding: "utf8",
    stdio: "pipe",
  });
}
