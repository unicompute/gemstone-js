#!/usr/bin/env node
import { loadPackageModule } from "./load-package-module.mjs";

const { runBenchmarkBaselinesCli } = await loadPackageModule("benchmark-baselines.ts");

process.exitCode = await runBenchmarkBaselinesCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
