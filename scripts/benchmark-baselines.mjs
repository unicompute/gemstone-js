#!/usr/bin/env node
import { runBenchmarkBaselinesCli } from "../src/benchmark-baselines.ts";

process.exitCode = await runBenchmarkBaselinesCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
