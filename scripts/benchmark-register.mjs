#!/usr/bin/env node
import { runBenchmarkRegisterCli } from "../src/benchmark-baselines.ts";

process.exitCode = await runBenchmarkRegisterCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
