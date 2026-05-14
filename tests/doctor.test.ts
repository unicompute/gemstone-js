import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDoctorReport,
  formatDoctorReport,
  runDoctorCli,
  type DoctorCliIo,
  type DoctorSession,
} from "../src/index.ts";

const doctorScript = fileURLToPath(new URL("../scripts/doctor.mjs", import.meta.url));

test("doctor reports local configuration warnings without exposing secrets", async () => {
  const report = await buildDoctorReport({
    env: {
      GS_STONE: "stone",
      GS_HOST: "host",
      GS_USERNAME: "",
      GS_PASSWORD: "",
      GS_LIB: "/gem/lib",
    },
    nativeProbe: async () => ({
      name: "native-package",
      status: "warning",
      message: "native unavailable in fixture",
    }),
    libraryHost: {
      listDir(path) {
        return path === "/gem/lib" ? ["libgcirpc-3.7.5-64.dylib"] : [];
      },
    },
  });

  assert.equal(report.status, "warning");
  assert.equal(report.config.usernameSet, false);
  assert.equal(report.config.passwordSet, false);
  assert(report.checks.some((check) => check.name === "gci-library" && check.status === "ok"));
  assert.match(formatDoctorReport(report), /gemstone-js doctor: warning/);
  assert.doesNotMatch(JSON.stringify(report), /swordfish/);
});

test("doctor live check connects, evaluates, and logs out", async () => {
  const calls: string[] = [];
  const session: DoctorSession = {
    async eval(source) {
      calls.push(`eval:${source}`);
      return 2;
    },
    async logout() {
      calls.push("logout");
    },
  };

  const report = await buildDoctorReport({
    live: true,
    native: false,
    env: {
      GS_USERNAME: "DataCurator",
      GS_PASSWORD: "swordfish",
      GS_LIB_PATH: "/gem/lib/libgcirpc.dylib",
    },
    connect: async (config) => {
      calls.push(`connect:${config.username}`);
      return session;
    },
  });

  assert.equal(report.status, "ok");
  assert.deepEqual(calls, ["connect:DataCurator", "eval:1 + 1", "logout"]);
  assert.equal(report.checks.find((check) => check.name === "live-login")?.status, "ok");
});

test("doctor CLI renders JSON and exits nonzero for failed live checks", async () => {
  const io = fakeIo();
  const code = await runDoctorCli(["--json", "--live", "--no-native"], io);

  assert.equal(code, 1);
  const report = JSON.parse(io.stdoutText());
  assert.equal(report.status, "error");
  assert.equal(report.config.usernameSet, false);
  assert.match(io.stderrText(), /^$/);
});

test("doctor CLI script prints help without probing native or connecting", async () => {
  const { stdout } = await execNode([doctorScript, "--help"]);

  assert.match(stdout, /gemstone-js-doctor/);
  assert.match(stdout, /--live/);
});

function fakeIo(): DoctorCliIo & {
  stdoutText(): string;
  stderrText(): string;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    env: {},
  };
}

function execNode(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}
