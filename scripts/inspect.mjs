#!/usr/bin/env node
import { loadPackageModule } from "./load-package-module.mjs";

const { Session } = await loadPackageModule("index.ts");
const { runInspectCli } = await loadPackageModule("inspection-cli.ts");

const code = await runInspectCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  connect: () => Session.connect(Session.configFromEnv()),
});

process.exitCode = code;
