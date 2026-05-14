import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  formatClassDescription,
  formatInspection,
  jsonOutput,
  parseInspectCliArgs,
  runInspectCli,
  type InspectCliSession,
} from "../src/inspection-cli.ts";
import { oop, type Oop } from "../src/index.ts";

const inspectScript = fileURLToPath(new URL("../scripts/inspect.mjs", import.meta.url));

test("inspection CLI parses OOP dump options", () => {
  const options = parseInspectCliArgs(["--oop", "0x2a", "--dump", "--depth", "3", "--no-indexed-fields"]);
  assert.equal(options.help, false);
  assert.equal(options.target, "oop");
  assert.equal(options.oop, 42n);
  assert.equal(options.dump, true);
  assert.equal(options.depth, 3);
  assert.equal(options.includeIndexedFields, false);
});

test("inspection CLI rejects invalid argument combinations", () => {
  assert.throws(() => parseInspectCliArgs([]), /Missing target/);
  assert.throws(() => parseInspectCliArgs(["--oop", "12", "--class", "Booking"]), /only one target/);
  assert.throws(() => parseInspectCliArgs(["--class", "Booking", "--dump"]), /--dump can only/);
  assert.throws(() => parseInspectCliArgs(["--oop", "-1"]), /requires a value/);
  assert.throws(() => parseInspectCliArgs(["--oop", "abc"]), /Invalid OOP/);
  assert.throws(() => parseInspectCliArgs(["--oop", "12", "--depth", "1.5"]), /non-negative integer/);
});

test("inspection CLI formats inspection and class output", () => {
  const inspection = formatInspection({
    oop: oop(123n),
    class: "Booking",
    classOop: oop(456n),
    printString: "a Booking",
    size: 1,
    byteSize: 0,
    classHierarchy: ["Booking", "Object"],
    slots: [{ name: "id", value: "B-1001", oop: oop(789n), class: "String" }],
    indexedFields: [{ index: 1, value: "item" }],
  });
  assert.match(inspection, /Class: Booking/);
  assert.match(inspection, /id: B-1001 \[String oop=789\]/);
  assert.match(inspection, /1: item/);

  const description = formatClassDescription({
    name: "Booking",
    oop: oop(456n),
    instanceCount: 2,
    superclasses: ["Object"],
    instVarNames: ["id"],
    classInstVarNames: ["Cache"],
  });
  assert.match(description, /Instance Variables:\n  id/);
  assert.match(description, /Class Instance Variables:\n  Cache/);
});

test("inspection CLI JSON output converts bigint OOPs to decimal strings", () => {
  assert.equal(jsonOutput({ oop: oop(123n), nested: [oop(456n)] }), "{\n  \"oop\": \"123\",\n  \"nested\": [\n    \"456\"\n  ]\n}\n");
});

test("inspection CLI runs inspect, dump, and class commands with injected sessions", async () => {
  const inspected: Oop[] = [];
  const dumps: Array<{ oop: Oop; depth?: number; includeIndexedFields?: boolean }> = [];
  let describedClass = "";
  let logoutCount = 0;
  const session: InspectCliSession = {
    async inspect(value) {
      inspected.push(value);
      return { oop: value, class: "Booking", printString: "a Booking", slots: [], indexedFields: [] };
    },
    async dump(value, options) {
      dumps.push({ oop: value, depth: options?.depth, includeIndexedFields: options?.includeIndexedFields });
      return { oop: value, oopString: value.toString(), class: "Booking", printString: "a Booking" };
    },
    async describeClass(name) {
      describedClass = name;
      return { name, superclasses: ["Object"], instVarNames: [], classInstVarNames: [] };
    },
    async logout() {
      logoutCount += 1;
    },
  };

  const inspectIo = fakeIo(session);
  assert.equal(await runInspectCli(["--oop", "123"], inspectIo), 0);
  assert.deepEqual(inspected, [oop(123n)]);
  assert.match(inspectIo.stdoutText(), /Print: a Booking/);

  const dumpIo = fakeIo(session);
  assert.equal(await runInspectCli(["--oop", "456", "--dump", "--depth", "1", "--no-indexed-fields"], dumpIo), 0);
  assert.deepEqual(dumps, [{ oop: oop(456n), depth: 1, includeIndexedFields: false }]);
  assert.match(dumpIo.stdoutText(), /"oop": "456"/);

  const classIo = fakeIo(session);
  assert.equal(await runInspectCli(["--class", "Booking", "--json"], classIo), 0);
  assert.equal(describedClass, "Booking");
  assert.match(classIo.stdoutText(), /"name": "Booking"/);
  assert.equal(logoutCount, 3);
});

test("inspection CLI script prints help without connecting", async () => {
  const { stdout } = await execNode([inspectScript, "--help"]);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /gemstone-js-inspect --oop <oop>/);
});

function fakeIo(session: InspectCliSession): {
  stdoutText(): string;
  stderrText(): string;
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  connect(): Promise<InspectCliSession>;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
    connect: async () => session,
  };
}

function execNode(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
