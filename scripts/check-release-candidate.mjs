#!/usr/bin/env node
import { execFileSync } from "node:child_process";

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function main(args) {
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }
  const skipLive = args.includes("--skip-live");
  const unexpected = args.filter((arg) => arg !== "--skip-live");
  if (unexpected.length > 0) {
    throw new Error(`Unknown release candidate check option: ${unexpected.join(" ")}`);
  }
  if (!skipLive && process.env.GS_RUN_LIVE !== "1") {
    throw new Error("Release candidate check requires GS_RUN_LIVE=1. Use --skip-live only for dry-run packaging validation.");
  }

  runNpmScript("verify", {}, ["GS_RUN_LIVE"]);
  if (skipLive) {
    runNpmScript("native-install:check", {}, ["GS_RUN_LIVE"]);
    console.log("Release candidate dry-run check passed without live GemStone smoke.");
    return;
  }

  runNpmScript("native-install:check", {
    GS_RUN_LIVE: "1",
    GS_NATIVE_SESSION_WORKER: "1",
  });
  runNpmScript("test:live:worker", {
    GS_RUN_LIVE: "1",
    GS_NATIVE_SESSION_WORKER: "1",
  });
  console.log("Release candidate check passed with worker-mode live smoke.");
}

function runNpmScript(name, overrides = {}, unset = []) {
  const env = { ...process.env, ...overrides };
  for (const key of unset) delete env[key];
  console.log(`\n> npm run ${name}`);
  execFileSync("npm", ["run", name], {
    encoding: "utf8",
    env,
    stdio: "inherit",
  });
}

function printUsage() {
  console.log(`Usage: npm run release-candidate:check [-- --skip-live]

Runs the conservative gemstone-js beta release-candidate gate:
  1. npm run verify without inherited GS_RUN_LIVE
  2. npm run native-install:check
  3. worker-mode live smoke when GS_RUN_LIVE=1

Set GS_RUN_LIVE=1 for the real release-candidate check. Use --skip-live only
for dry-run packaging validation on machines without GemStone access.`);
}
