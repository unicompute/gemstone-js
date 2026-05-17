#!/usr/bin/env node
import { loadPackageModule } from "./load-package-module.mjs";

const { Session } = await loadPackageModule("index.ts");
const { runBootstrapCli } = await loadPackageModule("bootstrap.ts");

const code = await runBootstrapCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  connect: () => Session.connect(Session.configFromEnv()),
});

process.exitCode = code;
