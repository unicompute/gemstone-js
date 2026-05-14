#!/usr/bin/env node
import { Session } from "../src/index.ts";
import { runBenchmarksCli } from "../src/benchmarks.ts";

process.exitCode = await runBenchmarksCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  connect: () => Session.connect(Session.configFromEnv()),
});
