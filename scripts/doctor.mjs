#!/usr/bin/env node
import { loadPackageModule } from "./load-package-module.mjs";

const { Session } = await loadPackageModule("index.ts");
const { runDoctorCli } = await loadPackageModule("doctor.ts");

const code = await runDoctorCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  connect: (config) => Session.connect(config),
});

process.exitCode = code;
