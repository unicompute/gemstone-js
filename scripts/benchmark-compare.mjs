#!/usr/bin/env node
import { loadPackageModule } from "./load-package-module.mjs";

const { runBenchmarkCompareCli } = await loadPackageModule("benchmark-baselines.ts");

process.exitCode = await runBenchmarkCompareCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
