#!/usr/bin/env node
import { Session } from "../src/index.ts";
import { runInspectCli } from "../src/inspection-cli.ts";

const code = await runInspectCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  connect: () => Session.connect(Session.configFromEnv()),
});

process.exitCode = code;
