import assert from "node:assert/strict";
import test from "node:test";
import { GSCollection, PersistentRoot, Session, smallintToOop } from "../src/index.ts";

const runLive = process.env.GS_RUN_LIVE === "1";

test("live GemStone regression smoke", { skip: runLive ? false : "set GS_RUN_LIVE=1 to run live GemStone checks" }, async () => {
  await using session = await Session.connect(Session.configFromEnv());

  assert.equal(await session.eval("1 + 1"), 2n);

  const objectClass = session.classRef("Object");
  const objectClassOop = await objectClass.oop();
  assert.equal(await objectClass.sendOop("yourself"), objectClassOop);
  assert.equal(await session.performValueWith(smallintToOop(7), "yourself"), 7n);

  const stringOop = await session.newString("gemstone-js live");
  assert.equal(await session.marshalOop(stringOop), "gemstone-js live");

  const floatOop = await session.floatOop(1.25);
  assert.equal(await session.marshalOop(floatOop), 1.25);

  const nestedArray = await session.array([2, false]);
  const array = await session.array(["gemstone-js live", nestedArray, true]);
  assert.equal(await array.sendValue("size"), 3n);
  assert.deepEqual(await session.arrayValues(array), ["gemstone-js live", [2n, false], true]);
  await nestedArray.release();
  await array.release();

  const dict = await session.dictionary({ status: "ready", count: 2 });
  assert.equal(await dict.get("status"), "ready");
  assert.equal(await dict.get("count"), 2n);
  assert.equal(await dict.size(), 2);
  assert.equal(await dict.isEmpty(), false);
  assert.deepEqual(new Set(await dict.keys()), new Set(["status", "count"]));
  assert.equal((await dict.entries()).status, "ready");
  assert.deepEqual(new Set(await dict.values()), new Set(["ready", 2n]));
  assert.deepEqual(new Map(await dict.items()).get("status"), "ready");
  const dictValueOops = await dict.valuesOop();
  assert.deepEqual(new Set(await Promise.all(dictValueOops.map((oop) => session.marshalOop(oop)))), new Set(["ready", 2n]));
  const dictItemsOop = new Map(await Promise.all((await dict.itemsOop()).map(async ([key, oop]) => (
    [key, await session.marshalOop(oop)] as const
  ))));
  assert.equal(dictItemsOop.get("status"), "ready");
  assert.equal(await dict.requireValue("status"), "ready");
  assert.equal(await dict.remove("count"), true);
  assert.equal(await dict.has("count"), false);
  assert.equal(await dict.delete("missing"), false);

  const object = await objectClass.sendObject("new");
  assert.equal(object.session, session);
  await object.release();

  const root = new PersistentRoot(session);
  const key = `GemstoneJsLive_${Date.now()}`;
  const extraKey = `${key}_Extra`;
  const globalKey = `${key}_Global`;
  const globalExtraKey = `${key}_GlobalExtra`;
  const globalObjectKey = `${key}_GlobalObject`;
  const dictKey = `${key}_Dict`;
  await session.globalSetAll({ [globalKey]: "global", [globalExtraKey]: "global-extra" });
  await session.globalSetAllOop({ [globalObjectKey]: object });
  assert.equal(await session.globalHas(globalKey), true);
  assert.equal(await session.globalGet(globalKey), "global");
  assert.equal(await session.globalRequireValue(globalKey), "global");
  const globalObject = await session.globalRequireObject(globalObjectKey);
  assert.equal(globalObject.oop, object.oop);
  await globalObject.release();
  assert.equal((await session.globalKeys()).includes(globalKey), true);
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
  assert.equal(await session.globalRemove(globalKey), true);
  assert.equal(await session.globalDelete(globalExtraKey), true);
  assert.equal(await session.globalDelete(globalObjectKey), true);
  assert.equal(await session.globalHas(globalKey), false);
  assert.equal(await session.globalDelete(globalKey), false);
  await root.setAllValue({ [key]: "ok", [extraKey]: "extra" });
  await root.setDict(dictKey, { status: "stored" });
  assert.equal(await root.getValue(key), "ok");
  assert.equal(await root.getValue(extraKey), "extra");
  assert.equal(await root.has(key), true);
  assert.equal(await root.requireValue(key), "ok");
  assert.equal((await root.keys()).includes(key), true);
  assert.deepEqual(await root.pick([key, `${key}_Missing`]), { [key]: "ok", [`${key}_Missing`]: null });
  assert.equal(await (await root.requireDict(dictKey)).requireValue("status"), "stored");
  assert.equal(await root.remove(key), true);
  assert.equal(await root.has(key), false);
  assert.equal(await root.delete(extraKey), true);
  assert.equal(await root.delete(dictKey), true);
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
  assert.equal(await query.exists("key", "=", "missing"), false);
  const firstDone = await query.first("key", "=", "done");
  assert.notEqual(firstDone, null);
  await firstDone?.release();
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
  await query.clear();
  assert.equal(await query.isEmpty(), true);
  assert.equal(await session.globalDelete(queryKey), true);

  await session.abort();
});
