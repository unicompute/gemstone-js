#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

try {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
  } else if (args.length === 1 && args[0] === "--self-test") {
    selfTest();
  } else if (args.length === 1) {
    const report = validateProvenanceMetadataFile(args[0]);
    process.stdout.write(`Provenance metadata check passed: ${report.signatureCount} signature(s), ${report.integrityAlgorithm} integrity.\n`);
  } else {
    throw new Error("Usage: node scripts/verify-provenance-metadata.mjs <npm-view-json> | --self-test");
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function validateProvenanceMetadataFile(path) {
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read provenance metadata JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateProvenanceMetadata(metadata, basename(path));
}

function validateProvenanceMetadata(metadata, label = "metadata") {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`Provenance metadata ${label} must be a JSON object.`);
  }
  const integrity = field(metadata, ["dist.integrity"], ["dist", "integrity"], ["integrity"]);
  if (typeof integrity !== "string" || !/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(integrity)) {
    throw new Error(`Provenance metadata ${label} must include dist.integrity with an SRI sha digest.`);
  }
  const signatures = field(metadata, ["dist.signatures"], ["dist", "signatures"], ["signatures"]);
  if (!Array.isArray(signatures) || signatures.length === 0) {
    throw new Error(`Provenance metadata ${label} must include at least one dist.signatures entry.`);
  }
  for (const [index, signature] of signatures.entries()) {
    if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
      throw new Error(`Provenance signature ${index} in ${label} must be an object.`);
    }
    if (typeof signature.keyid !== "string" || signature.keyid.trim() === "") {
      throw new Error(`Provenance signature ${index} in ${label} must include a keyid.`);
    }
    if (typeof signature.sig !== "string" || signature.sig.trim() === "") {
      throw new Error(`Provenance signature ${index} in ${label} must include a sig value.`);
    }
  }
  return {
    integrityAlgorithm: integrity.slice(0, integrity.indexOf("-")),
    signatureCount: signatures.length,
  };
}

function field(source, ...paths) {
  for (const path of paths) {
    let value = source;
    for (const segment of path) {
      value = value?.[segment];
    }
    if (value !== undefined) return value;
  }
  return undefined;
}

function selfTest() {
  const workspace = mkdtempSync(join(tmpdir(), "gemstone-js-provenance-"));
  try {
    const valid = join(workspace, "valid.json");
    writeFileSync(valid, JSON.stringify({
      "dist.integrity": "sha512-AbCdEf0123456789+/=",
      "dist.signatures": [{ keyid: "SHA256:abc", sig: "MEUCIQDabc" }],
    }));
    validateProvenanceMetadataFile(valid);

    const nested = join(workspace, "nested.json");
    writeFileSync(nested, JSON.stringify({
      dist: {
        integrity: "sha512-ZXhhbXBsZQ==",
        signatures: [{ keyid: "SHA256:def", sig: "MEQCIDef" }],
      },
    }));
    validateProvenanceMetadataFile(nested);

    assertInvalid(workspace, "missing-integrity.json", { "dist.signatures": [{ keyid: "key", sig: "sig" }] }, /dist\.integrity/);
    assertInvalid(workspace, "bad-integrity.json", {
      "dist.integrity": "not-sri",
      "dist.signatures": [{ keyid: "key", sig: "sig" }],
    }, /SRI/);
    assertInvalid(workspace, "missing-signatures.json", { "dist.integrity": "sha512-ZXhhbXBsZQ==" }, /dist\.signatures/);
    assertInvalid(workspace, "empty-signatures.json", {
      "dist.integrity": "sha512-ZXhhbXBsZQ==",
      "dist.signatures": [],
    }, /dist\.signatures/);
    assertInvalid(workspace, "bad-signature.json", {
      "dist.integrity": "sha512-ZXhhbXBsZQ==",
      "dist.signatures": [{ keyid: "", sig: "sig" }],
    }, /keyid/);
    process.stdout.write("Provenance metadata self-check passed.\n");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function assertInvalid(workspace, fileName, value, pattern) {
  const path = join(workspace, fileName);
  writeFileSync(path, JSON.stringify(value));
  try {
    validateProvenanceMetadataFile(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) {
      throw new Error(`Expected provenance validation failure ${pattern}, got: ${message}`);
    }
    return;
  }
  throw new Error(`Expected invalid provenance metadata to fail: ${fileName}`);
}

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/verify-provenance-metadata.mjs <npm-view-json>
  node scripts/verify-provenance-metadata.mjs --self-test

Validate saved npm registry provenance/signature metadata from:

  npm view <package>@<version> dist.integrity dist.signatures --json > npm-provenance.json

The check is offline. It validates that the saved JSON contains an SRI
dist.integrity value and at least one dist.signatures entry with keyid and sig.
`);
}
