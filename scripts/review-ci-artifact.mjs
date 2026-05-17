#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const checksumVerifier = join(scriptDir, "verify-checksums.mjs");

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    printUsage();
    return;
  }
  const artifactDir = resolve(options.dir);
  if (!existsSync(artifactDir) || !statSync(artifactDir).isDirectory()) {
    throw new Error(`CI artifact directory does not exist: ${artifactDir}`);
  }
  const manifestPath = join(artifactDir, "SHA256SUMS.txt");
  if (!existsSync(manifestPath)) {
    throw new Error(`CI artifact is missing SHA256SUMS.txt: ${artifactDir}`);
  }
  const tarballs = readdirSync(artifactDir).filter((entry) => entry.endsWith(".tgz")).sort();
  if (tarballs.length !== 1) {
    throw new Error(`CI artifact must contain exactly one .tgz file; found ${tarballs.length}: ${tarballs.join(", ")}`);
  }

  execFileSync(process.execPath, [checksumVerifier, manifestPath], {
    cwd: artifactDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  assertChecksumTargets(manifestPath, tarballs);

  const tarballPath = join(artifactDir, tarballs[0]);
  const entries = tarEntries(tarballPath);
  const packageJson = JSON.parse(readTarEntry(tarballPath, "package/package.json"));
  const localPackageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (packageJson.name !== "gemstone-js") {
    throw new Error(`CI tarball package name must be gemstone-js; found ${JSON.stringify(packageJson.name)}.`);
  }
  if (packageJson.version !== localPackageJson.version) {
    throw new Error(`CI tarball version ${packageJson.version} does not match local package version ${localPackageJson.version}.`);
  }
  const expectedFileName = `gemstone-js-${packageJson.version}.tgz`;
  if (tarballs[0] !== expectedFileName) {
    throw new Error(`CI tarball filename must be ${expectedFileName}; found ${tarballs[0]}.`);
  }
  if (packageJson.publishConfig?.provenance !== true) {
    throw new Error("CI tarball package.json must keep publishConfig.provenance=true.");
  }
  if (packageJson.optionalDependencies?.["@gemstone-js/native"] !== localPackageJson.optionalDependencies?.["@gemstone-js/native"]) {
    throw new Error("CI tarball optional @gemstone-js/native version must match local package.json.");
  }
  assertTarballContents(tarballPath, entries, packageJson);
  console.log(`CI artifact review passed: ${packageJson.name}@${packageJson.version} (${tarballs[0]}).`);
}

function parseArgs(args) {
  const options = { dir: ".", help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dir") {
      const value = args[index + 1];
      if (!value) throw new Error("--dir requires a path.");
      options.dir = value;
      index += 1;
    } else {
      throw new Error(`Unknown CI artifact review option: ${arg}`);
    }
  }
  return options;
}

function assertChecksumTargets(manifestPath, expected) {
  const actual = readFileSync(manifestPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[a-fA-F0-9]{64}  ([^\r\n]+)$/);
      if (!match) throw new Error(`Invalid checksum line: ${line}`);
      return match[1];
    })
    .sort();
  if (actual.length !== expected.length || actual.some((target, index) => target !== expected[index])) {
    throw new Error(`CI checksum targets must be exactly ${expected.join(", ")}; found ${actual.join(", ")}.`);
  }
}

function assertTarballContents(tarballPath, entries, packageJson) {
  const entrySet = new Set(entries);
  for (const required of [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/docs/beta.md",
    "package/docs/releasing.md",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/src/index.ts",
    "package/schemas/codegen-manifest.schema.json",
    "package/scripts/api-contract.mjs",
    "package/scripts/check-native-install.mjs",
    "package/scripts/check-release-artifacts.mjs",
    "package/scripts/check-release-candidate.mjs",
    "package/scripts/review-ci-artifact.mjs",
    "package/scripts/verify-checksums.mjs",
    "package/scripts/verify-provenance-metadata.mjs",
    "package/scripts/write-checksums.mjs",
  ]) {
    if (!entrySet.has(required)) {
      throw new Error(`CI tarball is missing required entry: ${required}`);
    }
  }
  for (const forbidden of ["package/tests/", "package/node_modules/", "package/.git/", "package/.github/"]) {
    if (entries.some((entry) => entry === forbidden || entry.startsWith(forbidden))) {
      throw new Error(`CI tarball unexpectedly includes forbidden entry: ${forbidden}`);
    }
  }
  assertPackageTargets(entries, packageJson);
  assertBinShebangs(tarballPath, packageJson);
}

function assertPackageTargets(entries, packageJson) {
  const entrySet = new Set(entries);
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
      throw new Error(`CI tarball is missing ${labels.join(", ")} target: ${entry}`);
    }
  }
}

function assertBinShebangs(tarballPath, packageJson) {
  for (const [name, target] of Object.entries(packageJson.bin ?? {})) {
    const entry = `package/${normalizePackageTarget(target)}`;
    const firstLine = readTarEntry(tarballPath, entry).split(/\r?\n/, 1)[0];
    if (firstLine !== "#!/usr/bin/env node") {
      throw new Error(`CI tarball bin ${name} target must have a Node shebang: ${entry}`);
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

function tarEntries(tarballPath) {
  return execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
}

function readTarEntry(tarballPath, entry) {
  return execFileSync("tar", ["-xOf", tarballPath, entry], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

function printUsage() {
  console.log(`Usage: npm run ci-artifact:review -- --dir <artifact-directory>

Reviews a downloaded GitHub Actions package artifact. The directory must contain
exactly one gemstone-js .tgz file and SHA256SUMS.txt.`);
}
