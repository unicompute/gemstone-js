#!/usr/bin/env node
import { runBenchmarkValidateCli } from "../src/benchmark-baselines.ts";

process.exitCode = await runBenchmarkValidateCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
