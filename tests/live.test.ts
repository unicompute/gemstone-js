import assert from "node:assert/strict";
import test from "node:test";
import {
  GSCollection,
  GStore,
  ObjectLog,
  PersistentRoot,
  Session,
  SessionPool,
  currentVersion,
  downgrade,
  gemstoneExpress,
  gemstoneFastify,
  gemstoneFetch,
  gemstoneHono,
  smallintToOop,
  upgrade,
  withSessionScope,
  type MigrationStep,
} from "../src/index.ts";
import {
  generatedNewObject,
  generatedObjectClassOop,
  generatedObjectPrintString,
} from "./fixtures/live-codegen.generated.ts";

const runLive = process.env.GS_RUN_LIVE === "1";

test("live GemStone regression smoke", { skip: runLive ? false : "set GS_RUN_LIVE=1 to run live GemStone checks" }, async () => {
  const session = await Session.connect(Session.configFromEnv());
  try {

  assert.equal(await session.eval("1 + 1"), 2n);

  const objectClass = session.classRef("Object");
  const objectClassOop = await objectClass.oop();
  assert.equal(await objectClass.sendOop("yourself"), objectClassOop);
  assert.match(String(await generatedObjectPrintString(session)), /Object/);
  assert.equal(await generatedObjectClassOop(session), objectClassOop);
  const generatedObject = await generatedNewObject(session);
  assert.equal(generatedObject.session, session);
  await generatedObject.release();
  const liveBulkObjects = await session.bulkPerformObjects([objectClassOop], "new");
  assert.equal(liveBulkObjects.length, 1);
  await Promise.all(liveBulkObjects.map((item) => item.release()));
  const liveBulkCallObjects = await session.performCallsObjectsWith([{ receiver: objectClassOop, selector: "new" }]);
  assert.equal(liveBulkCallObjects.length, 1);
  await Promise.all(liveBulkCallObjects.map((item) => item.release()));
  const executedObject = await session.executeObject("Object new");
  assert.equal(executedObject.session, session);
  await executedObject.release();
  const executedManaged = await session.executeManaged("Object new");
  assert.equal(executedManaged.session, session);
  await executedManaged.release();
  assert.equal(await session.performValueWith(smallintToOop(7), "yourself"), 7n);
  assert.deepEqual(await session.bulkPerformOop([smallintToOop(7), smallintToOop(8)], "yourself"), [
    smallintToOop(7),
    smallintToOop(8),
  ]);
  assert.deepEqual(await session.performManyValue([smallintToOop(7), smallintToOop(8)], "yourself"), [7n, 8n]);
  assert.deepEqual(await session.performCallsValue([
    { receiver: smallintToOop(7), selector: "yourself" },
    [smallintToOop(8), "yourself"],
  ]), [7n, 8n]);
  assert.deepEqual(await session.bulkPerformValueWith([smallintToOop(7), smallintToOop(8)], "+", 1), [8n, 9n]);
  assert.deepEqual(await session.performCallsValueWith([
    { receiver: smallintToOop(7), selector: "+", args: [1] },
    [smallintToOop(8), "+", [1]],
  ]), [8n, 9n]);

  const stringOop = await session.newString("gemstone-js live");
  assert.equal(await session.marshalOop(stringOop), "gemstone-js live");

  const objectLog = new ObjectLog(session);
  const objectLogLabel = `gemstone-js live objectlog ${Date.now()}`;
  const objectLogEntriesToDelete: Array<{ index: number }> = [];
  try {
    await objectLog.info(`${objectLogLabel} info`);
    await objectLog.error(`${objectLogLabel} error`);
    assert.equal(await objectLog.hasEntries(), true);
    assert.equal(await objectLog.hasEntries("error"), true);
    assert.ok(await objectLog.count() >= 2);
    assert.ok(await objectLog.countFor("error") >= 1);
    const recentObjectLogEntries = await objectLog.latest(50);
    objectLogEntriesToDelete.push(...recentObjectLogEntries.filter((entry) => entry.label.startsWith(objectLogLabel)));
    assert.equal(recentObjectLogEntries.some((entry) => entry.label === `${objectLogLabel} info`), true);
    const recentObjectLogErrors = await objectLog.latestFor("error", 50);
    objectLogEntriesToDelete.push(...recentObjectLogErrors.filter((entry) => entry.label.startsWith(objectLogLabel)));
    assert.equal(recentObjectLogErrors.some((entry) => entry.label === `${objectLogLabel} error`), true);
    const recentObjectLogErrorsViaOptions = await objectLog.entries({ level: "error", order: "newest", maxEntries: 50 });
    assert.equal(recentObjectLogErrorsViaOptions.some((entry) => entry.label === `${objectLogLabel} error`), true);
  } finally {
    await objectLog.deleteAll(objectLogEntriesToDelete);
  }

  const floatOop = await session.floatOop(1.25);
  assert.equal(await session.marshalOop(floatOop), 1.25);

  const nestedArray = await session.array([2, false]);
  const array = await session.array(["gemstone-js live", nestedArray, true]);
  assert.equal(await array.sendValue("size"), 3n);
  assert.deepEqual(await session.arrayValues(array), ["gemstone-js live", [2n, false], true]);
  assert.equal(await session.arraySize(array), 3);
  assert.equal(await session.arrayIsEmpty(array), false);
  assert.equal(await session.arrayAtValue(array, 1), "gemstone-js live");
  assert.equal(await session.arrayAtOop(array, 2), nestedArray.oop);
  const liveArrayNested = await session.arrayAtObject(array, 2);
  assert.equal(liveArrayNested.oop, nestedArray.oop);
  await liveArrayNested.release();
  assert.equal(await session.arrayFirstValue(array), "gemstone-js live");
  assert.equal(await session.arrayFirst(array), "gemstone-js live");
  const liveArrayFirst = await session.arrayFirstObject(array);
  assert.notEqual(liveArrayFirst, null);
  await liveArrayFirst?.release();
  assert.equal(await session.arrayLastValue(array), true);
  const liveArrayPageValues = await session.arrayPageValue(array, 1, 2);
  assert.equal(liveArrayPageValues[0], "gemstone-js live");
  assert.equal(liveArrayPageValues[1], nestedArray.oop);
  assert.equal((await session.arrayPageOop(array, 2, 10))[0], nestedArray.oop);
  const liveArrayPageObjects = await session.arrayPageObjects(array, 1, 2);
  assert.equal(liveArrayPageObjects.length, 2);
  await Promise.all(liveArrayPageObjects.map((item) => item.release()));
  assert.deepEqual(await session.arrayTakeValue(array, 1), ["gemstone-js live"]);
  assert.equal((await session.arrayTakeOop(array, 2))[1], nestedArray.oop);
  assert.equal((await session.arrayPickValue(array, [1]))[1], "gemstone-js live");
  assert.equal((await session.arrayPickOop(array, [2]))[2], nestedArray.oop);
  await session.arrayAtPut(array, 3, false);
  assert.equal(await session.arrayAtValue(array, 3), false);
  await session.arraySetAllValue(array, { 1: "gemstone-js batch", 3: true });
  assert.equal(await session.arrayAtValue(array, 1), "gemstone-js batch");
  assert.equal(await session.arrayAtValue(array, 3), true);
  await session.arraySetOop(array, 2, nestedArray);
  assert.equal(await session.arrayAtOop(array, 2), nestedArray.oop);
  assert.equal((await session.arrayOops(array)).length, 3);
  const objectForArray = await objectClass.sendObject("new");
  const objectArray = await session.array([objectForArray]);
  const liveArrayObjects = await session.arrayObjects(objectArray);
  assert.equal(liveArrayObjects.length, 1);
  await Promise.all(liveArrayObjects.map((item) => item.release()));
  const liveArrayObjectsFromOop = await session.arrayOopToObjects(objectArray.oop);
  assert.equal(liveArrayObjectsFromOop.length, 1);
  await Promise.all(liveArrayObjectsFromOop.map((item) => item.release()));
  await objectArray.release();
  await objectForArray.release();
  await nestedArray.release();
  await array.release();

  const dict = await session.dictionary({ status: "ready", count: 2 });
  assert.equal(await dict.get("status"), "ready");
  assert.equal(await dict.get("count"), 2n);
  assert.deepEqual(await session.dictionaryOopToObject(dict.oop), { status: "ready", count: 2n });
  assert.deepEqual(await session.dictionaryValues(dict.oop), { status: "ready", count: 2n });
  assert.equal((await session.dictionaryEntries(dict.oop)).status, "ready");
  assert.deepEqual(new Set(await session.dictionaryKeys(dict.oop)), new Set(["status", "count"]));
  assert.equal(await session.dictionarySize(dict.oop), 2);
  assert.equal(await session.dictionaryIsEmpty(dict.oop), false);
  assert.equal(await session.dictionaryHas(dict.oop, "status"), true);
  assert.deepEqual(await session.dictionaryHasAll(dict.oop, ["status", "missing"]), { status: true, missing: false });
  assert.equal((await session.dictionaryPick(dict.oop, ["status", "missing"])).status, "ready");
  assert.equal(await session.dictionaryRequireValue(dict.oop, "status"), "ready");
  assert.deepEqual(await session.dictionaryRequireAllValue(dict.oop, ["status"]), { status: "ready" });
  const requiredSessionDictStatus = await session.dictionaryRequireObject(dict.oop, "status");
  await requiredSessionDictStatus.release();
  assert.equal((await session.dictionaryEntriesOop(dict.oop)).status !== null, true);
  assert.equal(new Map(await session.dictionaryItems(dict.oop)).get("status"), "ready");
  const sessionDictItemsOop = new Map(await session.dictionaryItemsOop(dict.oop));
  const sessionDictStatusOop = sessionDictItemsOop.get("status");
  if (sessionDictStatusOop === undefined) throw new Error("dictionaryItemsOop should include status.");
  assert.equal(await session.marshalOop(sessionDictStatusOop), "ready");
  assert.deepEqual(new Set(await session.dictionaryValueList(dict.oop)), new Set(["ready", 2n]));
  const sessionDictValueOops = await session.dictionaryValueOops(dict.oop);
  assert.deepEqual(new Set(await Promise.all(sessionDictValueOops.map((oop) => session.marshalOop(oop)))), new Set(["ready", 2n]));
  const dictObject = await objectClass.sendObject("new");
  await session.dictionarySetValue(dict.oop, "mode", "active");
  await session.dictionarySetAllValue(dict.oop, { batch: "yes" });
  await session.dictionarySetObject(dict.oop, "object", dictObject);
  await session.dictionarySetAllObject(dict.oop, { objectBatch: dictObject });
  await session.dictionarySetDict(dict.oop, "sessionNested", { status: "session-child" });
  assert.equal(await session.dictionaryGetValue(dict.oop, "mode"), "active");
  assert.equal(await session.dictionaryGet(dict.oop, "batch"), "yes");
  assert.equal(await session.dictionaryGetOop(dict.oop, "object"), dictObject.oop);
  const liveDictObject = await session.dictionaryGetObject(dict.oop, "object");
  assert.equal(liveDictObject?.oop, dictObject.oop);
  await liveDictObject?.release();
  assert.equal(await (await session.dictionaryGetDict(dict.oop, "sessionNested"))?.requireValue("status"), "session-child");
  assert.equal(await session.dictionaryRemove(dict.oop, "mode"), true);
  assert.deepEqual(await session.dictionaryDeleteAll(dict.oop, ["batch", "object", "objectBatch", "sessionNested", "missing-session-key"]), {
    batch: true,
    object: true,
    objectBatch: true,
    sessionNested: true,
    "missing-session-key": false,
  });
  await dictObject.release();
  assert.deepEqual(await dict.toObject(), { status: "ready", count: 2n });
  assert.equal(await dict.size(), 2);
  assert.equal(await dict.isEmpty(), false);
  assert.deepEqual(await dict.hasAll(["status", "missing"]), { status: true, missing: false });
  assert.deepEqual(new Set(await dict.keys()), new Set(["status", "count"]));
  assert.deepEqual(new Set(await dict.keys({ maxEntries: 2 })), new Set(["status", "count"]));
  await assert.rejects(() => dict.keys({ maxEntries: 1 }), RangeError);
  assert.equal((await session.dictionaryEntries(dict.oop, { maxEntries: 2 })).status, "ready");
  assert.equal((await dict.entries()).status, "ready");
  assert.deepEqual(new Set(await dict.values()), new Set(["ready", 2n]));
  assert.deepEqual(new Map(await dict.items()).get("status"), "ready");
  await dict.replaceAll({ status: "replaced", count: 3 });
  assert.equal(await dict.requireValue("status"), "replaced");
  assert.equal(await dict.requireValue("count"), 3n);
  await dict.replaceAllValue({ status: "ready", count: 2 });
  assert.equal(await dict.requireValue("status"), "ready");
  const dictValueOops = await dict.valuesOop();
  assert.deepEqual(new Set(await Promise.all(dictValueOops.map((oop) => session.marshalOop(oop)))), new Set(["ready", 2n]));
  const dictItemsOop = new Map(await Promise.all((await dict.itemsOop()).map(async ([key, oop]) => (
    [key, await session.marshalOop(oop)] as const
  ))));
  assert.equal(dictItemsOop.get("status"), "ready");
  assert.equal(await dict.requireValue("status"), "ready");
  await dict.setAllDict({ nested: { status: "child" } });
  assert.equal(await (await session.dictionaryPickDict(dict.oop, ["nested", "missing"])).nested?.requireValue("status"), "child");
  assert.equal(await (await session.dictionaryRequireDict(dict.oop, "nested")).requireValue("status"), "child");
  assert.equal(await (await session.dictionaryRequireAllDict(dict.oop, ["nested"])).nested.requireValue("status"), "child");
  const nestedDict = await dict.getDict("nested");
  if (!nestedDict) throw new Error("GsDict.getDict should return the live nested dictionary.");
  assert.equal(await nestedDict.requireValue("status"), "child");
  const pickedDictObjects = await dict.pickObject(["status", "missing"]);
  assert.notEqual(pickedDictObjects.status, null);
  assert.equal(pickedDictObjects.missing, null);
  await pickedDictObjects.status?.release();
  assert.equal(await (await dict.pickDict(["nested", "missing"])).nested?.requireValue("status"), "child");
  assert.equal(await (await dict.requireDict("nested")).requireValue("status"), "child");
  assert.equal(await (await dict.requireAllDict(["nested"])).nested.requireValue("status"), "child");
  assert.deepEqual(await dict.requireAllValue(["status"]), { status: "ready" });
  assert.deepEqual(await dict.deleteAll(["nested", "missing"]), { nested: true, missing: false });
  assert.deepEqual(await dict.removeAll(["count", "missing-count"]), { count: true, "missing-count": false });
  assert.equal(await dict.has("count"), false);
  await dict.clear();
  assert.equal(await dict.isEmpty(), true);

  const object = await objectClass.sendObject("new");
  assert.equal(object.session, session);
  await object.release();

  const root = new PersistentRoot(session);
  const key = `GemstoneJsLive_${Date.now()}`;
  const extraKey = `${key}_Extra`;
  const globalKey = `${key}_Global`;
  const globalExtraKey = `${key}_GlobalExtra`;
  const globalValueKey = `${key}_GlobalValue`;
  const globalObjectKey = `${key}_GlobalObject`;
  const globalObjectAliasKey = `${key}_GlobalObjectAlias`;
  const globalObjectBatchAliasKey = `${key}_GlobalObjectBatchAlias`;
  const globalDictKey = `${key}_GlobalDict`;
  const dictKey = `${key}_Dict`;
  const gstoreName = `${key}.db`;
  const gstore = await GStore.open(session, gstoreName);
  try {
    assert.equal(await GStore.has(session, gstoreName), true);
    assert.equal(await GStore.exists(session, gstoreName), true);
    assert.equal(await gstore.exists(), true);
    assert.equal(await gstore.has(), true);
    await gstore.transaction((txn) => {
      txn.set("alpha", { name: "Tariq", count: 2 });
      txn.set("beta", ["a", "b"]);
    });
    const gstoreSnapshot = await gstore.transaction((txn) => txn.toObject(), { readOnly: true });
    assert.deepEqual(gstoreSnapshot, {
      alpha: { name: "Tariq", count: 2 },
      beta: ["a", "b"],
    });
    assert.deepEqual(await gstore.read({ maxEntries: 2 }), gstoreSnapshot);
    await assert.rejects(() => gstore.read({ maxEntries: 1 }), RangeError);
    const liveGStoreNames = await GStore.list(session);
    assert.equal(liveGStoreNames.includes(gstoreName), true);
    assert.equal((await GStore.list(session, { maxEntries: liveGStoreNames.length })).includes(gstoreName), true);
  } finally {
    await GStore.remove(session, gstoreName);
  }
  assert.equal(await GStore.has(session, gstoreName), false);
  await session.globalSetAllValue({ [globalKey]: "global", [globalExtraKey]: "global-extra" });
  await session.globalSetValue(globalValueKey, "global-value");
  await session.globalSetAllOop({ [globalObjectKey]: object });
  await session.globalSetObject(globalObjectAliasKey, object);
  await session.globalSetAllObject({ [globalObjectBatchAliasKey]: object });
  await session.globalSetAllDict({ [globalDictKey]: { status: "global-dict" } });
  assert.equal(await session.globalHas(globalKey), true);
  assert.deepEqual(await session.globalHasAll([globalKey, `${globalKey}_Missing`]), { [globalKey]: true, [`${globalKey}_Missing`]: false });
  assert.equal(await session.globalGet(globalKey), "global");
  assert.equal(await session.globalGetValue(globalValueKey), "global-value");
  assert.equal(await session.globalRequireValue(globalKey), "global");
  assert.deepEqual(await session.globalRequireAllValue([globalKey]), { [globalKey]: "global" });
  const requiredGlobalOops = await session.globalRequireAllOop([globalObjectKey, globalDictKey]);
  assert.equal(requiredGlobalOops[globalObjectKey], object.oop);
  assert.equal(await session.globalRequireOop(globalObjectAliasKey), object.oop);
  assert.equal(await session.globalRequireOop(globalObjectBatchAliasKey), object.oop);
  const globalObject = await session.globalRequireObject(globalObjectKey);
  assert.equal(globalObject.oop, object.oop);
  await globalObject.release();
  const pickedGlobalObjects = await session.globalPickObject([globalObjectKey, `${globalKey}_Missing`]);
  assert.equal(pickedGlobalObjects[globalObjectKey]?.oop, object.oop);
  assert.equal(pickedGlobalObjects[`${globalKey}_Missing`], null);
  await pickedGlobalObjects[globalObjectKey]?.release();
  const requiredGlobalObjects = await session.globalRequireAllObject([globalObjectKey]);
  assert.equal(requiredGlobalObjects[globalObjectKey].oop, object.oop);
  await requiredGlobalObjects[globalObjectKey].release();
  const globalDict = await session.globalGetDict(globalDictKey);
  if (!globalDict) throw new Error("globalGetDict should return the live dictionary.");
  assert.equal(await globalDict.requireValue("status"), "global-dict");
  assert.equal(await (await session.globalPickDict([globalDictKey, `${globalKey}_Missing`]))[globalDictKey]?.requireValue("status"), "global-dict");
  assert.equal(await (await session.globalRequireDict(globalDictKey)).requireValue("status"), "global-dict");
  assert.equal(await (await session.globalRequireAllDict([globalDictKey]))[globalDictKey].requireValue("status"), "global-dict");
  const liveGlobalKeys = await session.globalKeys();
  assert.equal(liveGlobalKeys.includes(globalKey), true);
  assert.equal((await session.globalKeys({ maxEntries: liveGlobalKeys.length })).includes(globalKey), true);
  await assert.rejects(() => session.globalKeys({ maxEntries: 0 }), RangeError);
  assert.ok(await session.globalSize() > 0);
  assert.equal(await session.globalIsEmpty(), false);
  assert.deepEqual(await session.globalPick([globalKey, `${globalKey}_Missing`]), { [globalKey]: "global", [`${globalKey}_Missing`]: null });
  const liveGlobalPickOop = await session.globalPickOop([globalKey, `${globalKey}_Missing`]);
  const pickedGlobalOop = liveGlobalPickOop[globalKey];
  if (pickedGlobalOop === null) throw new Error("globalPickOop should include the live global value.");
  assert.equal(await session.marshalOop(pickedGlobalOop), "global");
  assert.equal(liveGlobalPickOop[`${globalKey}_Missing`], null);
  assert.equal((await session.globalEntries())[globalKey], "global");
  const entryGlobalOop = (await session.globalEntriesOop())[globalKey];
  if (entryGlobalOop === null) throw new Error("globalEntriesOop should include the live global value.");
  assert.equal(await session.marshalOop(entryGlobalOop), "global");
  assert.equal((await session.globalValues()).includes("global"), true);
  assert.equal(new Map(await session.globalItems()).get(globalKey), "global");
  const globalItemsOop = new Map(await session.globalItemsOop());
  const globalValueOop = globalItemsOop.get(globalKey);
  if (globalValueOop === undefined) throw new Error("globalItemsOop should include the live global value.");
  assert.equal(await session.marshalOop(globalValueOop), "global");
  assert.equal((await session.globalValuesOop()).some((oop) => oop === object.oop), true);
  assert.deepEqual(await session.globalRemoveAll([globalKey, globalExtraKey]), { [globalKey]: true, [globalExtraKey]: true });
  assert.deepEqual(await session.globalDeleteAll([globalValueKey, globalObjectKey, globalObjectAliasKey, globalObjectBatchAliasKey, globalDictKey, `${globalKey}_Missing`]), {
    [globalValueKey]: true,
    [globalObjectKey]: true,
    [globalObjectAliasKey]: true,
    [globalObjectBatchAliasKey]: true,
    [globalDictKey]: true,
    [`${globalKey}_Missing`]: false,
  });
  assert.equal(await session.globalHas(globalKey), false);
  assert.equal(await session.globalDelete(globalKey), false);
  await root.setAllValue({ [key]: "ok", [extraKey]: "extra" });
  const rootObjectKey = `${key}_Object`;
  const rootObjectOopKey = `${rootObjectKey}_Oop`;
  const rootObjectAliasKey = `${rootObjectKey}_Alias`;
  const rootObjectBatchOopKey = `${rootObjectKey}_BatchOop`;
  const rootObjectBatchAliasKey = `${rootObjectKey}_BatchAlias`;
  await root.setAll({ [rootObjectKey]: object.oop });
  await root.setOop(rootObjectOopKey, object.oop);
  await root.setObject(rootObjectAliasKey, object);
  await root.setAllOop({ [rootObjectBatchOopKey]: object.oop });
  await root.setAllObject({ [rootObjectBatchAliasKey]: object });
  await root.setAllDict({ [dictKey]: { status: "stored" } });
  assert.equal(await root.getValue(key), "ok");
  assert.equal(await root.getValue(extraKey), "extra");
  assert.equal(await root.has(key), true);
  assert.deepEqual(await root.hasAll([key, `${key}_Missing`]), { [key]: true, [`${key}_Missing`]: false });
  assert.equal(await root.requireValue(key), "ok");
  assert.deepEqual(await root.requireAllValue([key]), { [key]: "ok" });
  const liveRootKeys = await root.keys();
  assert.equal(liveRootKeys.includes(key), true);
  assert.equal((await root.keys({ maxEntries: liveRootKeys.length })).includes(key), true);
  await assert.rejects(() => root.keys({ maxEntries: 0 }), RangeError);
  assert.ok(await root.size() > 0);
  assert.equal(await root.isEmpty(), false);
  assert.deepEqual(await root.pick([key, `${key}_Missing`]), { [key]: "ok", [`${key}_Missing`]: null });
  const requiredRootOops = await root.requireAllOop([rootObjectKey, dictKey]);
  assert.equal(requiredRootOops[rootObjectKey], object.oop);
  assert.equal(await root.requireOop(rootObjectOopKey), object.oop);
  assert.equal(await root.requireOop(rootObjectAliasKey), object.oop);
  assert.equal(await root.requireOop(rootObjectBatchOopKey), object.oop);
  assert.equal(await root.requireOop(rootObjectBatchAliasKey), object.oop);
  const requiredRootObjects = await root.requireAllObject([rootObjectKey]);
  assert.equal(requiredRootObjects[rootObjectKey].oop, object.oop);
  await requiredRootObjects[rootObjectKey].release();
  const pickedRootObjects = await root.pickObject([rootObjectKey, `${key}_Missing`]);
  assert.equal(pickedRootObjects[rootObjectKey]?.oop, object.oop);
  assert.equal(pickedRootObjects[`${key}_Missing`], null);
  await pickedRootObjects[rootObjectKey]?.release();
  assert.equal(await (await root.requireDict(dictKey)).requireValue("status"), "stored");
  assert.equal(await (await root.pickDict([dictKey, `${key}_Missing`]))[dictKey]?.requireValue("status"), "stored");
  assert.equal(await (await root.requireAllDict([dictKey]))[dictKey].requireValue("status"), "stored");
  assert.deepEqual(await root.removeAll([key, extraKey]), { [key]: true, [extraKey]: true });
  assert.equal(await root.has(key), false);
  assert.deepEqual(await root.deleteAll([rootObjectKey, rootObjectOopKey, rootObjectAliasKey, rootObjectBatchOopKey, rootObjectBatchAliasKey, dictKey, `${key}_Missing`]), {
    [rootObjectKey]: true,
    [rootObjectOopKey]: true,
    [rootObjectAliasKey]: true,
    [rootObjectBatchOopKey]: true,
    [rootObjectBatchAliasKey]: true,
    [dictKey]: true,
    [`${key}_Missing`]: false,
  });
  assert.equal(await root.delete(`${key}_Missing`), false);

  const queryKey = `${key}_Query`;
  const queryCollection = await session.execute(`
    | collection |
    collection := OrderedCollection new.
    collection add: ('ready' -> 1).
    collection add: ('ready' -> 2).
    collection add: ('done' -> 3).
    collection
  `);
  await session.globalSetOop(queryKey, queryCollection);
  const query = new GSCollection(session, queryKey);
  assert.equal((await query.allOop()).length, 3);
  assert.equal((await query.pageOop(2, 2)).length, 2);
  const secondQueryItem = await query.at(2);
  assert.notEqual(secondQueryItem, null);
  await secondQueryItem?.release();
  assert.equal(await query.itemAtOop(99), null);
  const firstQueryItem = await query.firstItem();
  assert.notEqual(firstQueryItem, null);
  await firstQueryItem?.release();
  assert.notEqual(await query.lastItemOop(), null);
  const queuedAssoc = await session.execute("'queued' -> 4");
  await query.addOop(queuedAssoc);
  assert.equal(await query.size(), 4);
  assert.equal(await query.includesOop(queuedAssoc), true);
  assert.equal(await query.removeOop(queuedAssoc), true);
  await query.addAll(["plain value", "plain extra"]);
  assert.equal(await query.contains("plain value"), true);
  assert.equal(await query.remove("plain value"), true);
  assert.equal(await query.removeAll(["plain extra", "missing plain"]), 1);
  assert.equal(await query.delete("plain value"), false);
  assert.equal(await query.count("key", "=", "ready"), 2);
  assert.equal(await query.exists("key", "=", "done"), true);
  assert.equal(await query.any("key", "=", "done"), true);
  assert.equal(await query.anyMatch("key", "=", "missing"), false);
  assert.equal(await query.none("key", "=", "missing"), true);
  assert.equal(await query.exists("key", "=", "missing"), false);
  const firstDone = await query.first("key", "=", "done");
  assert.notEqual(firstDone, null);
  await firstDone?.release();
  const foundDone = await query.find("key", "=", "done");
  assert.notEqual(foundDone, null);
  await foundDone?.release();
  const limited = await query.limit("key", "=", "ready", 1);
  assert.equal(limited.length, 1);
  await Promise.all(limited.map((item) => item.release()));
  if (await session.eval(`${queryKey} respondsTo: #createEqualityIndexOn:`) === true) {
    await query.createIndex("key");
    await query.removeIndex("key");
  }
  await query.replaceAll(["replacement"]);
  assert.equal(await query.size(), 1);
  assert.equal(await query.includes("replacement"), true);
  assert.deepEqual(await query.allValues(), ["replacement"]);
  assert.deepEqual(await query.pageValues(1, 1), ["replacement"]);
  assert.equal(await query.atValue(1), "replacement");
  assert.equal(await query.firstItemValue(), "replacement");
  assert.equal(await query.lastItemValue(), "replacement");
  assert.equal(await query.firstValue("yourself", "=", "replacement"), "replacement");
  const iteratedValues: unknown[] = [];
  for await (const value of query.iterValues(1)) iteratedValues.push(value);
  assert.deepEqual(iteratedValues, ["replacement"]);
  await query.clear();
  assert.equal(await query.isEmpty(), true);
  assert.equal(await session.globalDelete(queryKey), true);

  const largeQueryKey = `${key}_LargeQuery`;
  const largeQueryCollection = await session.execute(`
    | collection |
    collection := OrderedCollection new.
    1 to: 30 do: [:index |
      collection add: (((index <= 20) ifTrue: ['batch'] ifFalse: ['tail']) -> index)].
    collection
  `);
  await session.globalSetOop(largeQueryKey, largeQueryCollection);
  const largeQuery = new GSCollection(session, largeQueryKey);
  try {
    assert.equal(await largeQuery.size(), 30);
    assert.equal(await largeQuery.count("key", "=", "batch"), 20);
    assert.equal(await largeQuery.exists("value", ">=", 30), true);
    assert.equal(await largeQuery.any("key", "=", "tail"), true);
    assert.equal(await largeQuery.none("value", ">", 30), true);
    const largeLimited = await largeQuery.limit("key", "=", "batch", 5);
    assert.equal(largeLimited.length, 5);
    await Promise.all(largeLimited.map((item) => item.release()));
    assert.equal((await largeQuery.takeOop("key", "=", "tail", 3)).length, 3);
    assert.notEqual(await largeQuery.firstOop("key", "=", "tail"), null);
    assert.equal((await largeQuery.pageOop(21, 10)).length, 10);
  } finally {
    await session.globalDelete(largeQueryKey).catch(() => false);
  }

  const migrationRootKey = `${key}_Migrations`;
  const migrationLockKey = `${key}_MigrationsLock`;
  const migrationProbeKey = `${key}_MigrationProbe`;
  const scopeCommitKey = `${key}_ScopeCommit`;
  const scopeAbortKey = `${key}_ScopeAbort`;
  const fetchCommitKey = `${key}_FetchCommit`;
  const fetchAbortKey = `${key}_FetchAbort`;
  const expressCommitKey = `${key}_ExpressCommit`;
  const expressAbortKey = `${key}_ExpressAbort`;
  const fastifyCommitKey = `${key}_FastifyCommit`;
  const fastifyAbortKey = `${key}_FastifyAbort`;
  const honoCommitKey = `${key}_HonoCommit`;
  const honoAbortKey = `${key}_HonoAbort`;
  const migrationStep: MigrationStep = {
    id: "001_live_probe",
    checksum: "live-smoke",
    description: "Live gemstone-js migration probe.",
    upgrade: async (current) => {
      await current.globalSet(migrationProbeKey, "ready");
    },
    downgrade: async (current) => {
      await current.globalRemove(migrationProbeKey);
    },
  };
  try {
    const migrationResult = await upgrade(session, [migrationStep], {
      rootKey: migrationRootKey,
      lockKey: migrationLockKey,
      lockOwner: "gemstone-js-live-smoke",
    });
    assert.deepEqual(migrationResult.steps, ["001_live_probe"]);
    assert.equal(await currentVersion(session, { rootKey: migrationRootKey }), "001_live_probe");
    assert.equal(await session.globalGetValue(migrationProbeKey), "ready");

    const migrationRollback = await downgrade(session, [migrationStep], {
      target: "base",
      rootKey: migrationRootKey,
      lockKey: migrationLockKey,
      lockOwner: "gemstone-js-live-smoke",
    });
    assert.deepEqual(migrationRollback.steps, ["001_live_probe"]);
    assert.equal(await currentVersion(session, { rootKey: migrationRootKey }), null);
    assert.equal(await session.globalHas(migrationProbeKey), false);
  } finally {
    await session.globalDelete(migrationProbeKey).catch(() => false);
    await session.globalDelete(migrationRootKey).catch(() => false);
    await session.globalDelete(migrationLockKey).catch(() => false);
    await session.commit().catch(() => undefined);
  }

  const poolEvents: string[] = [];
  const pool = new SessionPool({
    ...Session.configFromEnv(),
    name: "gemstone-js-live-pool",
    maxSize: 1,
    validationIntervalMs: 0,
    validationQuery: "1 + 1",
    eventListener: (event) => poolEvents.push(event.name),
  });
  try {
  assert.equal(await pool.warm(1), 1);
  assert.equal(pool.stats().idle, 1);
  assert.equal(await pool.withSession((pooled) => pooled.eval("3 + 4")), 7n);
  assert.ok(poolEvents.includes("session_created"));
  assert.ok(poolEvents.includes("session_acquired"));
  assert.ok(poolEvents.includes("session_released"));

  const heldLease = await pool.acquire();
  const queuedLeasePromise = pool.acquire(1_000);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(pool.stats().pendingAcquires, 1);
  await heldLease.release({ clean: true });
  const queuedLease = await queuedLeasePromise;
  assert.equal(await queuedLease.session.eval("5 + 6"), 11n);
  await queuedLease.release({ clean: true });
  assert.equal(pool.stats().pendingAcquires, 0);
  assert.ok(poolEvents.includes("acquire_queued"));

  assert.equal(await withSessionScope({ pool }, async (scoped) => {
    await scoped.globalSetValue(scopeCommitKey, "scope-commit");
    return scoped.globalGetValue(scopeCommitKey);
  }), "scope-commit");
  assert.equal(await pool.withSession((pooled) => pooled.globalGetValue(scopeCommitKey)), "scope-commit");

  await assert.rejects(
    () => withSessionScope({ pool }, async (scoped) => {
      await scoped.globalSetValue(scopeAbortKey, "scope-abort");
      throw new Error("live request scope failure");
    }),
    /live request scope failure/,
  );
  assert.equal(await pool.withSession((pooled) => pooled.globalHas(scopeAbortKey)), false);

  const fetchApp = gemstoneFetch(async (_request, context) => {
    await context.session.globalSetValue(fetchCommitKey, "fetch-commit");
    return new Response(String(await context.session.eval("4 + 5")), { status: 201 });
  }, { pool, serverErrorStatus: 500 });
  const fetchResponse = await fetchApp(new Request("http://gemstone-js.test/live"));
  assert.equal(fetchResponse.status, 201);
  assert.equal(await fetchResponse.text(), "9");
  assert.equal(await pool.withSession((pooled) => pooled.globalGetValue(fetchCommitKey)), "fetch-commit");

  const fetchAbortApp = gemstoneFetch(async (_request, context) => {
    await context.session.globalSetValue(fetchAbortKey, "fetch-abort");
    return new Response("bad request", { status: 400 });
  }, { pool, serverErrorStatus: 400 });
  const fetchAbortResponse = await fetchAbortApp(new Request("http://gemstone-js.test/live-abort"));
  assert.equal(fetchAbortResponse.status, 400);
  assert.equal(await pool.withSession((pooled) => pooled.globalHas(fetchAbortKey)), false);

  const expressMiddleware = gemstoneExpress({ pool, serverErrorStatus: 400 });
  const expressReq: Record<string, unknown> = {};
  const expressRes = new LiveFakeExpressResponse(201);
  await expressMiddleware(expressReq, expressRes, (error?: unknown) => {
    if (error) throw error;
  });
  const expressSession = expressReq.gemstoneSession as Session;
  await expressSession.globalSetValue(expressCommitKey, "express-commit");
  await expressRes.emit("finish");
  assert.equal(await pool.withSession((pooled) => pooled.globalGetValue(expressCommitKey)), "express-commit");

  const expressAbortReq: Record<string, unknown> = {};
  const expressAbortRes = new LiveFakeExpressResponse(400);
  await expressMiddleware(expressAbortReq, expressAbortRes, (error?: unknown) => {
    if (error) throw error;
  });
  await (expressAbortReq.gemstoneSession as Session).globalSetValue(expressAbortKey, "express-abort");
  await expressAbortRes.emit("finish");
  assert.equal(await pool.withSession((pooled) => pooled.globalHas(expressAbortKey)), false);

  const fastifyHooks = new Map<string, Function>();
  await gemstoneFastify({
    decorateRequest() {},
    addHook(name: string, fn: Function) {
      fastifyHooks.set(name, fn);
    },
  }, { pool, serverErrorStatus: 400 });
  const fastifyRequest: Record<string, unknown> = {};
  await fastifyHooks.get("onRequest")?.(fastifyRequest);
  await (fastifyRequest.gemstoneSession as Session).globalSetValue(fastifyCommitKey, "fastify-commit");
  await fastifyHooks.get("onResponse")?.(fastifyRequest, { statusCode: 201 });
  assert.equal(await pool.withSession((pooled) => pooled.globalGetValue(fastifyCommitKey)), "fastify-commit");

  const fastifyAbortRequest: Record<string, unknown> = {};
  await fastifyHooks.get("onRequest")?.(fastifyAbortRequest);
  await (fastifyAbortRequest.gemstoneSession as Session).globalSetValue(fastifyAbortKey, "fastify-abort");
  await fastifyHooks.get("onResponse")?.(fastifyAbortRequest, { statusCode: 400 });
  assert.equal(await pool.withSession((pooled) => pooled.globalHas(fastifyAbortKey)), false);

  const honoMiddleware = gemstoneHono({ pool, serverErrorStatus: 400 });
  const honoContext = new LiveFakeHonoContext(201);
  await honoMiddleware(honoContext, async () => {
    const honoSession = honoContext.get("gemstoneSession") as Session;
    await honoSession.globalSetValue(honoCommitKey, "hono-commit");
  });
  assert.equal(await pool.withSession((pooled) => pooled.globalGetValue(honoCommitKey)), "hono-commit");

  const honoAbortContext = new LiveFakeHonoContext(400);
  await honoMiddleware(honoAbortContext, async () => {
    const honoSession = honoAbortContext.get("gemstoneSession") as Session;
    await honoSession.globalSetValue(honoAbortKey, "hono-abort");
  });
  assert.equal(await pool.withSession((pooled) => pooled.globalHas(honoAbortKey)), false);

  await withSessionScope({ pool }, async (scoped) => {
    await scoped.globalDeleteAll([
      scopeCommitKey,
      fetchCommitKey,
      expressCommitKey,
      expressAbortKey,
      fastifyCommitKey,
      fastifyAbortKey,
      honoCommitKey,
      honoAbortKey,
    ]);
  });
  assert.equal(await pool.withSession((pooled) => pooled.globalHas(scopeCommitKey)), false);
  assert.equal(await pool.withSession((pooled) => pooled.globalHas(fetchCommitKey)), false);
  } finally {
    await pool.close().catch(() => undefined);
  }

  await session.abort();
  } finally {
    await session.logout().catch(() => undefined);
  }
});

test("live GemStone worker backend stress", { skip: runLive ? false : "set GS_RUN_LIVE=1 to run live GemStone checks" }, async () => {
  const session = await Session.connect({
    ...Session.configFromEnv(),
    nativeSessionWorker: true,
  });

  try {
    assert.equal(session.runtime.name, "node-worker");
    assert.deepEqual(await Promise.all([
      session.eval("100 + 1"),
      session.eval("100 + 2"),
      session.performValueWith(smallintToOop(103), "yourself"),
    ]), [101n, 102n, 103n]);

    const workerText = await session.newString("worker backend live");
    assert.equal(new TextDecoder().decode(await session.runtime.fetchBytes(workerText, 1, 6)), "worker");

    const retained = await session.executeObject("Object new");
    await retained.release();

    await assert.rejects(
      () => session.runtime.fetchBytes(workerText, 0, 1),
      Error,
    );
    await session.abort().catch(() => undefined);
    assert.equal(await session.eval("40 + 2"), 42n);
  } finally {
    await session.logout();
  }

  assert.equal(session.loggedIn, false);
});

class LiveFakeExpressResponse {
  readonly statusCode: number;
  readonly #handlers = new Map<string, Array<() => void | Promise<void>>>();

  constructor(statusCode: number) {
    this.statusCode = statusCode;
  }

  on(name: string, handler: () => void | Promise<void>): void {
    const handlers = this.#handlers.get(name) ?? [];
    handlers.push(handler);
    this.#handlers.set(name, handlers);
  }

  async emit(name: string): Promise<void> {
    for (const handler of this.#handlers.get(name) ?? []) {
      await handler();
    }
  }
}

class LiveFakeHonoContext {
  readonly values = new Map<string, unknown>();
  readonly res: { status: number };

  constructor(status: number) {
    this.res = { status };
  }

  set(key: string, value: unknown): void {
    this.values.set(key, value);
  }

  get(key: string): unknown {
    return this.values.get(key);
  }
}
