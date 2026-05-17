import assert from "node:assert/strict";
import test from "node:test";
import {
  OOP_NIL,
  ObjectLog,
  decodeEscapedField,
  formatObjectLogEntries,
  formatObjectLogEntry,
  parseObjectLogEntries,
  summarizeObjectLogEntries,
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
  const entries = parseObjectLogEntries(String.raw`4|hello\pworld|obj\\repr\nline|123|2026-04-19\r12:00|1|'tag\pvalue'|7\q`);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].priority, 4);
  assert.equal(entries[0].levelName, "info");
  assert.equal(entries[0].label, "hello|world");
  assert.equal(entries[0].objectRepr, "obj\\repr\nline");
  assert.equal(entries[0].pid, 123);
  assert.equal(entries[0].timestamp, "2026-04-19\r12:00");
  assert.equal(entries[0].tagged, true);
  assert.equal(entries[0].tag, "tag|value");
  assert.equal(entries[0].index, 7);

  const legacyEntries = parseObjectLogEntries(String.raw`4|legacy|nil|1|stamp|0|\q`);
  assert.equal(legacyEntries[0].index, 0);
});

test("ObjectLog entries can be summarized and formatted", () => {
  const entries = parseObjectLogEntries([
    String.raw`4|hello|nil|123|stamp-one|0||0\q`,
    String.raw`2|bad|object|456|stamp-two|1|'urgent'|1\q`,
  ].join(""));

  assert.deepEqual(summarizeObjectLogEntries(entries), {
    total: 2,
    levels: { info: 1, error: 1 },
    tagged: 1,
    firstIndex: 0,
    lastIndex: 1,
  });
  assert.equal(formatObjectLogEntry(entries[1]), "#1 [error] bad (tag=urgent)");
  assert.equal(
    formatObjectLogEntry(entries[1], {
      includeTimestamp: true,
      includePid: true,
      includeObject: true,
    }),
    "#1 stamp-two [error] bad (pid=456, tag=urgent, object=object)",
  );
  assert.equal(
    formatObjectLogEntries(entries, { includeIndex: false, includeTag: false }),
    "[info] hello\n[error] bad",
  );
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
  const allRows = [
    String.raw`4|hello|nil|123|stamp|0||0\q`,
    String.raw`2|bad|object|456|later|1|'urgent'|1\q`,
    String.raw`2|worse|object|789|latest|0||2\q`,
  ].join("");
  const errorRows = [
    String.raw`2|bad|object|456|later|1|'urgent'|1\q`,
    String.raw`2|worse|object|789|latest|0||2\q`,
  ].join("");
  const latestErrorRow = String.raw`2|worse|object|789|latest|0||2\q`;
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    async execute(source) {
      executeSources.push(source);
      if (source.includes("ObjectLogEntry objectLog.") && source.includes("\\q")) {
        if (source.includes("limit := 0.")) return runtime.newString("");
        if (source.includes("priorityFilter := 2.") && source.includes("step := -1.")) {
          return runtime.newString(latestErrorRow);
        }
        if (source.includes("priorityFilter := 2.")) return runtime.newString(errorRows);
        if (source.includes("step := -1.")) return runtime.newString(latestErrorRow);
        return runtime.newString(allRows);
      }
      if (source.includes("ObjectLogEntry objectLog do:") && source.includes("entry priority = 2")) {
        return runtime.newString("2");
      }
      if (source.includes("detect: [:entry | entry priority = 2]")) {
        return runtime.newString("true");
      }
      if (source.includes("detect: [:entry | entry priority = 6]")) {
        return runtime.newString("false");
      }
      if (source === "ObjectLogEntry objectLog size printString") {
        return runtime.newString("3");
      }
      return OOP_NIL;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const log = new ObjectLog(session);

  const entries = await log.entries();
  assert.equal(entries.length, 3);
  assert.equal(entries[0].levelName, "info");
  assert.equal(entries[1].levelName, "error");
  assert.equal(entries[1].tag, "urgent");
  assert.equal((await log.entries({ maxEntries: 3 })).length, 3);
  await assert.rejects(() => log.entries({ maxEntries: 2 }), /maxEntries 2/);
  await assert.rejects(() => log.entries({ maxEntries: -1 }), /non-negative safe integer/);
  await assert.rejects(() => log.entries({ order: "middle" as never }), /read order/);
  assert.deepEqual((await log.entries({ order: "newest", maxEntries: 1 })).map((entry) => [entry.index, entry.label]), [[2, "worse"]]);
  assert.deepEqual((await log.entries({ level: "error" })).map((entry) => entry.label), ["bad", "worse"]);
  assert.deepEqual((await log.entries({ level: "error", order: "newest", maxEntries: 1 })).map((entry) => [entry.index, entry.label]), [[2, "worse"]]);
  assert.deepEqual((await log.latest(1)).map((entry) => [entry.index, entry.label]), [[2, "worse"]]);
  assert.deepEqual((await log.tail(1)).map((entry) => [entry.index, entry.label]), [[2, "worse"]]);
  await assert.rejects(() => log.latest(-1), /latest maxEntries/);
  assert.deepEqual((await log.errors()).map((entry) => entry.label), ["bad", "worse"]);
  assert.deepEqual((await log.errors({ maxEntries: 2 })).map((entry) => entry.label), ["bad", "worse"]);
  await assert.rejects(() => log.errors({ maxEntries: 1 }), /maxEntries 1/);
  assert.deepEqual((await log.latestFor("error", 1)).map((entry) => [entry.index, entry.label]), [[2, "worse"]]);
  assert.deepEqual((await log.tailFor(2, 1)).map((entry) => [entry.index, entry.label]), [[2, "worse"]]);
  await assert.rejects(() => log.latestFor("error", -1), /latestFor maxEntries/);
  assert.equal(await log.size(), 3);
  assert.equal(await log.count(), 3);
  assert.equal(await log.isEmpty(), false);
  assert.equal(await log.countFor("error"), 2);
  assert.equal(await log.sizeFor(2), 2);
  assert.equal(await log.hasEntries(), true);
  assert.equal(await log.hasEntries("error"), true);
  assert.equal(await log.hasEntries("trace"), false);
  assert.deepEqual(await log.summarize({ level: "error" }), {
    total: 2,
    levels: { error: 2 },
    tagged: 1,
    firstIndex: 1,
    lastIndex: 2,
  });
  assert.equal(await log.formatEntries({ level: "error", maxEntries: 2 }), "#1 [error] bad (tag=urgent)\n#2 [error] worse");

  await log.clear();
  await log.remove(entries[1]);
  await log.removeAll([{ index: 2 }, { index: 1 }, { index: 2 }]);
  await log.deleteAll([{ index: 0 }]);
  await log.clearFor("error");
  await log.clearLevel(2);
  await assert.rejects(() => log.remove({ index: -1 }), /non-negative safe integer/);
  await assert.rejects(() => log.removeAll([{ index: -1 }]), /non-negative safe integer/);

  assert(executeSources.some((source) => source === "ObjectLogEntry objectLog removeAllSuchThat: [:entry | true]."));
  assert(executeSources.some((source) => source.includes("log removeAtIndex: 2")));
  assert(executeSources.some((source) => source.includes("indexes := #(3 2).")));
  assert(executeSources.some((source) => source.includes("indexes := #(1).")));
  assert(executeSources.some((source) => source === "ObjectLogEntry objectLog removeAllSuchThat: [:entry | entry priority = 2]."));
  assert(executeSources.some((source) => source.includes("limit := 3.")), "bounded entries should include one sentinel row");
  assert(executeSources.some((source) => source.includes("index := log size - 1.")), "latest should scan from the GemStone-side tail");
  assert(executeSources.some((source) => source.includes("priorityFilter := 2.")), "level reads should filter on the GemStone side");
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
