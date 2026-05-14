#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Session } from "../src/index.ts";
import { migrationStepsFromManifest, runMigrationsCli } from "../src/migrations.ts";

const code = await runMigrationsCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  connect: () => Session.connect(Session.configFromEnv()),
  loadManifest: async (specifier) => {
    const href = specifier.startsWith("file:") || specifier.includes("://")
      ? specifier
      : pathToFileURL(resolve(specifier)).href;
    return migrationStepsFromManifest(await import(href));
  },
});

process.exitCode = code;
