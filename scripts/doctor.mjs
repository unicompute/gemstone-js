#!/usr/bin/env node
import { Session } from "../src/index.ts";
import { runDoctorCli } from "../src/doctor.ts";

const code = await runDoctorCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  connect: (config) => Session.connect(config),
});

process.exitCode = code;
