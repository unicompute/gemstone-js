import assert from "node:assert/strict";
import test from "node:test";
import {
  OOP_NIL,
  ObjectLog,
  decodeEscapedField,
  parseObjectLogEntries,
  type Oop,
  Session,
} from "../src/index.ts";
import { escapedFieldEncoderSource } from "../src/smalltalk-source.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

test("decodeEscapedField restores ObjectLog escaped delimiters", () => {
  assert.equal(decodeEscapedField(String.raw`alpha\pbravo\ncharlie\rdelta\\echo`), "alpha|bravo\ncharlie\rdelta\\echo");
});

test("escapedFieldEncoderSource matches the GemStone batch encoding contract", () => {
  const source = escapedFieldEncoderSource("encode");
  assert.match(source, /encode := \[:value/);
  assert.match(source, /copyReplaceAll: '\\' with: '\\\\'/);
  assert.match(source, /copyReplaceAll: String lf with: '\\n'/);
  assert.match(source, /copyReplaceAll: '\|' with: '\\p'/);
});

test("parseObjectLogEntries decodes batched ObjectLog rows", () => {
  const entries = parseObjectLogEntries(String.raw`4|hello\pworld|obj\\repr\nline|123|2026-04-19\r12:00|1|'tag\pvalue'\q`);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].priority, 4);
  assert.equal(entries[0].levelName, "info");
  assert.equal(entries[0].label, "hello|world");
  assert.equal(entries[0].objectRepr, "obj\\repr\nline");
  assert.equal(entries[0].pid, 123);
  assert.equal(entries[0].timestamp, "2026-04-19\r12:00");
  assert.equal(entries[0].tagged, true);
  assert.equal(entries[0].tag, "tag|value");
  assert.equal(entries[0].index, 0);
});

test("ObjectLog writes escaped labels and attached OOPs", async () => {
  const executeSources: string[] = [];
  const object = 0x9300n as Oop;
  const runtime = new MockGciRuntime({
    execute(source) {
      executeSources.push(source);
      return OOP_NIL;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const log = new ObjectLog(session);

  await log.info("Ada's booking", { objectOop: object });
  await log.error("failed");

  assert.equal(
    executeSources[0],
    `(ObjectLogEntry info: 'Ada''s booking' object: (Object _objectForOop: ${object.toString()})) addToLog.`,
  );
  assert.equal(executeSources[1], "(ObjectLogEntry error: 'failed' object: nil) addToLog.");
  await session.logout();
});

test("ObjectLog fetches, filters, sizes, clears, and removes entries", async () => {
  const executeSources: string[] = [];
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    async execute(source) {
      executeSources.push(source);
      if (source.includes("ObjectLogEntry objectLog.") && source.includes("\\q")) {
        return runtime.newString([
          String.raw`4|hello|nil|123|stamp|0|\q`,
          String.raw`2|bad|object|456|later|1|'urgent'\q`,
        ].join(""));
      }
      if (source === "ObjectLogEntry objectLog size printString") {
        return runtime.newString("2");
      }
      return OOP_NIL;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const log = new ObjectLog(session);

  const entries = await log.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].levelName, "info");
  assert.equal(entries[1].levelName, "error");
  assert.equal(entries[1].tag, "urgent");
  assert.deepEqual((await log.errors()).map((entry) => entry.label), ["bad"]);
  assert.equal(await log.size(), 2);

  await log.clear();
  await log.remove(entries[1]);
  await assert.rejects(() => log.remove({ index: -1 }), /non-negative safe integer/);

  assert(executeSources.some((source) => source === "ObjectLogEntry objectLog removeAllSuchThat: [:entry | true]."));
  assert(executeSources.some((source) => source.includes("log removeAtIndex: 2")));
  await session.logout();
});

test("ObjectLog rejects unknown levels", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const log = new ObjectLog(session);

  await assert.rejects(() => log.add(99 as never, "bad"), /Unknown ObjectLog priority/);
  await assert.rejects(() => log.entriesFor("verbose" as never), /Unknown ObjectLog level/);
  await session.logout();
});
