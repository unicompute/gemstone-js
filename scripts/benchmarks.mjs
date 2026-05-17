#!/usr/bin/env node
import { loadPackageModule } from "./load-package-module.mjs";

const { Session } = await loadPackageModule("index.ts");
const { runBenchmarksCli } = await loadPackageModule("benchmarks.ts");

process.exitCode = await runBenchmarksCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  connect: () => Session.connect(Session.configFromEnv()),
});
