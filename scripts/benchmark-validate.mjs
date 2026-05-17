#!/usr/bin/env node
import { loadPackageModule } from "./load-package-module.mjs";

const { runBenchmarkValidateCli } = await loadPackageModule("benchmark-baselines.ts");

process.exitCode = await runBenchmarkValidateCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
