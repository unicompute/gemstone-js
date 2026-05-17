#!/usr/bin/env node
import { loadPackageModule } from "./load-package-module.mjs";

const { runBenchmarkRegisterCli } = await loadPackageModule("benchmark-baselines.ts");

process.exitCode = await runBenchmarkRegisterCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
