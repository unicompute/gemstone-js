#!/usr/bin/env node
import { runBenchmarkCompareCli } from "../src/benchmark-baselines.ts";

process.exitCode = await runBenchmarkCompareCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
