#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const source = readFileSync("tests/live.test.ts", "utf8");

const skipOutput = execFileSync(process.execPath, ["--test", "tests/live.test.ts"], {
  encoding: "utf8",
  env: {
    ...process.env,
    GS_RUN_LIVE: "",
  },
  stdio: "pipe",
});
if (!skipOutput.includes("set GS_RUN_LIVE=1 to run live GemStone checks")) {
  throw new Error(`tests/live.test.ts skip output is missing GS_RUN_LIVE guidance:\n${skipOutput}`);
}

execFileSync(process.execPath, [
  "scripts/codegen.mjs",
  "--check",
  "tests/fixtures/live-codegen.manifest.json",
  "tests/fixtures/live-codegen.generated.ts",
], {
  encoding: "utf8",
  stdio: "pipe",
});

for (const snippet of [
  "const runLive = process.env.GS_RUN_LIVE === \"1\"",
  "Session.connect(Session.configFromEnv())",
  "await session.eval(\"1 + 1\")",
  "session.classRef(\"Object\")",
  "generatedObjectPrintString(session)",
  "generatedObjectClassOop(session)",
  "generatedNewObject(session)",
  "session.bulkPerformObjects",
  "session.performCallsObjectsWith",
  "session.performValueWith",
  "session.bulkPerformOop",
  "session.performManyValue",
  "session.performCallsValue",
  "session.bulkPerformValueWith",
  "session.performCallsValueWith",
  "session.newString",
  "new ObjectLog(session)",
  "objectLog.latest(50)",
  "objectLog.latestFor(\"error\", 50)",
  "objectLog.entries({ level: \"error\", order: \"newest\", maxEntries: 50 })",
  "objectLog.countFor(\"error\")",
  "objectLog.hasEntries(\"error\")",
  "objectLog.deleteAll",
  "session.floatOop",
  "session.arrayValues",
  "session.arrayPageValue",
  "session.arrayPickOop",
  "session.dictionary",
  "session.dictionaryItemsOop",
  "session.dictionaryEntries(dict.oop, { maxEntries: 2 })",
  "dict.valuesOop()",
  "dict.itemsOop()",
  "dict.keys({ maxEntries: 2 })",
  "session.globalKeys()",
  "session.globalKeys({ maxEntries: liveGlobalKeys.length })",
  "session.globalEntries()",
  "session.globalItemsOop()",
  "session.globalValuesOop()",
  "new PersistentRoot(session)",
  "root.keys({ maxEntries: liveRootKeys.length })",
  "root.requireAllOop",
  "root.pickObject",
  "root.requireAllDict",
  "GStore.open",
  "GStore.has(session, gstoreName)",
  "GStore.exists(session, gstoreName)",
  "gstore.exists()",
  "gstore.read({ maxEntries: 2 })",
  "GStore.list(session, { maxEntries: liveGStoreNames.length })",
  "new GSCollection(session",
  "query.count(",
  "query.exists(",
  "query.first(",
  "query.limit(",
  "query.createIndex(",
  "largeQuery.count(\"key\", \"=\", \"batch\")",
  "largeQuery.exists(\"value\", \">=\", 30)",
  "largeQuery.limit(\"key\", \"=\", \"batch\", 5)",
  "largeQuery.takeOop(\"key\", \"=\", \"tail\", 3)",
  "largeQuery.pageOop(21, 10)",
  "upgrade(session",
  "downgrade(session",
  "currentVersion(session",
  "new SessionPool({",
  "pool.warm(1)",
  "pool.acquire(1_000)",
  "pool.stats().pendingAcquires",
  "poolEvents.includes(\"acquire_queued\")",
  "pool.withSession",
  "withSessionScope({ pool }",
  "gemstoneFetch",
  "new Request(\"http://gemstone-js.test/live\")",
  "new Response(String(await context.session.eval(\"4 + 5\")), { status: 201 })",
  "new Response(\"bad request\", { status: 400 })",
  "gemstoneExpress({ pool, serverErrorStatus: 400 })",
  "new LiveFakeExpressResponse(201)",
  "new LiveFakeExpressResponse(400)",
  "gemstoneFastify({",
  "fastifyHooks.get(\"onRequest\")",
  "fastifyHooks.get(\"onResponse\")",
  "gemstoneHono({ pool, serverErrorStatus: 400 })",
  "new LiveFakeHonoContext(201)",
  "new LiveFakeHonoContext(400)",
  "nativeSessionWorker: true",
  "session.runtime.name",
  "\"node-worker\"",
  "Promise.all([",
  "session.runtime.fetchBytes",
  "session.runtime.fetchBytes(workerText, 0, 1)",
  "session.loggedIn",
  "await session.abort()",
]) {
  assertIncludes(source, snippet, `live smoke coverage snippet ${snippet}`);
}

console.log("GemStone live smoke check passed: skip path and coverage snippets are guarded.");

function assertIncludes(value, snippet, label) {
  if (!value.includes(snippet)) {
    throw new Error(`Missing ${label}: ${snippet}`);
  }
}
