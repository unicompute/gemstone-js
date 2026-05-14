#!/usr/bin/env node
import { Session } from "../src/index.ts";
import { runBootstrapCli } from "../src/bootstrap.ts";

const code = await runBootstrapCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  connect: () => Session.connect(Session.configFromEnv()),
});

process.exitCode = code;
