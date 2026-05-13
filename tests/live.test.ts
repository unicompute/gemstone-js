import assert from "node:assert/strict";
import test from "node:test";
import { PersistentRoot, Session, smallintToOop } from "../src/index.ts";

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
  assert.equal((await session.globalEntries())[globalKey], "global");
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

  await session.abort();
});
