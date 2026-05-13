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

  const dict = await session.dictionary({ status: "ready", count: 2 });
  assert.equal(await dict.get("status"), "ready");
  assert.equal(await dict.get("count"), 2n);
  assert.equal(await dict.size(), 2);
  assert.equal(await dict.isEmpty(), false);
  assert.deepEqual(new Set(await dict.keys()), new Set(["status", "count"]));
  assert.equal((await dict.entries()).status, "ready");
  assert.equal(await dict.requireValue("status"), "ready");

  const object = await objectClass.sendObject("new");
  assert.equal(object.session, session);
  await object.release();

  const root = new PersistentRoot(session);
  const key = `GemstoneJsLive_${Date.now()}`;
  const dictKey = `${key}_Dict`;
  await root.setValue(key, "ok");
  await root.setDict(dictKey, { status: "stored" });
  assert.equal(await root.getValue(key), "ok");
  assert.equal(await root.has(key), true);
  assert.equal(await root.requireValue(key), "ok");
  assert.equal((await root.keys()).includes(key), true);
  assert.deepEqual(await root.pick([key, `${key}_Missing`]), { [key]: "ok", [`${key}_Missing`]: null });
  assert.equal(await (await root.requireDict(dictKey)).requireValue("status"), "stored");

  await session.abort();
});
