#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./write-checksums.mjs", import.meta.url));
const verifyScript = fileURLToPath(new URL("./verify-checksums.mjs", import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), "gemstone-js-checksums-"));

try {
  writeFileSync(join(workspace, "package.tgz"), "package-tarball");
  writeFileSync(join(workspace, "notes.txt"), "ignored");
  mkdirSync(join(workspace, "directory.tgz"));

  execFileSync(process.execPath, [script, ".tgz"], {
    cwd: workspace,
    encoding: "utf8",
    stdio: "pipe",
  });

  const expected = `${sha256("package-tarball")}  package.tgz\n`;
  const actual = readFileSync(join(workspace, "SHA256SUMS.txt"), "utf8");
  if (actual !== expected) {
    throw new Error(`Unexpected SHA256SUMS.txt content.\nExpected:\n${expected}\nActual:\n${actual}`);
  }

  execFileSync(process.execPath, [verifyScript, "SHA256SUMS.txt"], {
    cwd: workspace,
    encoding: "utf8",
    stdio: "pipe",
  });
  assertMismatchFails();
  assertVerifierInputFailures();
  assertManifestIsExcluded();
  assertInvalidSuffixFails();
  assertWhitespaceArtifactNameFails();
  assertNonportableArtifactNameFails();
  assertDuplicateSuffixFails();
  assertNoMatchFails();
  process.stdout.write("Checksum helper check passed.\n");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function assertMismatchFails() {
  writeFileSync(join(workspace, "package.tgz"), "tampered-package-tarball");
  try {
    execFileSync(process.execPath, [verifyScript, "SHA256SUMS.txt"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    writeFileSync(join(workspace, "package.tgz"), "package-tarball");
    return;
  }
  throw new Error("verify-checksums.mjs should fail when a file hash does not match.");
}

function assertVerifierInputFailures() {
  assertVerifierFails("EMPTY-SHA256SUMS.txt", "");
  assertVerifierFails("BAD-SHA256SUMS.txt", "not-a-checksum-line\n");
  assertVerifierFails("MISSING-SHA256SUMS.txt", `${sha256("missing")}  missing.tgz\n`);
  assertVerifierFails("PATH-SHA256SUMS.txt", `${sha256("nested")}  nested/package.tgz\n`);
  assertVerifierFails("WHITESPACE-TARGET-SHA256SUMS.txt", `${sha256("spaced")}  spaced package.tgz\n`);
  assertVerifierFails("NONPORTABLE-TARGET-SHA256SUMS.txt", `${sha256("bad")}  bad#package.tgz\n`);
  assertVerifierFails("DIRECTORY-SHA256SUMS.txt", `${sha256("directory")}  directory.tgz\n`);
  assertVerifierFails("SELF-SHA256SUMS.txt", `${sha256("self-manifest")}  SELF-SHA256SUMS.txt\n`);
  assertVerifierFails("MANIFEST-TARGET-SHA256SUMS.txt", `${sha256("manifest")}  SHA256SUMS.txt\n`);
  assertVerifierFails("DUPLICATE-SHA256SUMS.txt", [
    `${sha256("package-tarball")}  package.tgz`,
    `${sha256("package-tarball")}  package.tgz`,
  ].join("\n") + "\n");
}

function assertVerifierFails(fileName, contents) {
  writeFileSync(join(workspace, fileName), contents);
  try {
    execFileSync(process.execPath, [verifyScript, fileName], {
      cwd: workspace,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    return;
  }
  throw new Error(`verify-checksums.mjs should fail for invalid manifest ${fileName}.`);
}

function assertManifestIsExcluded() {
  const manifestWorkspace = join(workspace, "manifest-exclusion");
  mkdirSync(manifestWorkspace);
  writeFileSync(join(manifestWorkspace, "notes.txt"), "ignored");
  writeFileSync(join(manifestWorkspace, "SHA256SUMS.txt"), "existing-manifest");
  execFileSync(process.execPath, [script, ".txt"], {
    cwd: manifestWorkspace,
    encoding: "utf8",
    stdio: "pipe",
  });
  const expected = `${sha256("ignored")}  notes.txt\n`;
  const actual = readFileSync(join(manifestWorkspace, "SHA256SUMS.txt"), "utf8");
  if (actual !== expected) {
    throw new Error(`write-checksums.mjs should exclude SHA256SUMS.txt from matching artifact suffixes.\nActual:\n${actual}`);
  }
}

function assertNoMatchFails() {
  try {
    execFileSync(process.execPath, [script, ".missing"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    return;
  }
  throw new Error("write-checksums.mjs should fail when no files match.");
}

function assertInvalidSuffixFails() {
  for (const suffix of ["", "tgz", ".", ".tgz/archive", ".tgz\\backup", ".tgz ", ".tgz\tbackup"]) {
    try {
      execFileSync(process.execPath, [script, suffix], {
        cwd: workspace,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch {
      continue;
    }
    throw new Error(`write-checksums.mjs should fail for invalid suffix ${JSON.stringify(suffix)}.`);
  }
}

function assertWhitespaceArtifactNameFails() {
  const artifactWorkspace = join(workspace, "whitespace-artifacts");
  mkdirSync(artifactWorkspace);
  writeFileSync(join(artifactWorkspace, "spaced package.tgz"), "spaced");
  try {
    execFileSync(process.execPath, [script, ".tgz"], {
      cwd: artifactWorkspace,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    return;
  }
  throw new Error("write-checksums.mjs should fail when a matching artifact file name contains whitespace.");
}

function assertNonportableArtifactNameFails() {
  const artifactWorkspace = join(workspace, "nonportable-artifacts");
  mkdirSync(artifactWorkspace);
  writeFileSync(join(artifactWorkspace, "bad#package.tgz"), "bad");
  try {
    execFileSync(process.execPath, [script, ".tgz"], {
      cwd: artifactWorkspace,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    return;
  }
  throw new Error("write-checksums.mjs should fail when a matching artifact file name is not portable ASCII.");
}

function assertDuplicateSuffixFails() {
  try {
    execFileSync(process.execPath, [script, ".tgz", ".tgz"], {
      cwd: workspace,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    return;
  }
  throw new Error("write-checksums.mjs should fail when suffix filters are duplicated.");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
