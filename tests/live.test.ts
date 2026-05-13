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

  const object = await objectClass.sendObject("new");
  assert.equal(object.session, session);
  await object.release();

  const root = new PersistentRoot(session);
  const key = `GemstoneJsLive_${Date.now()}`;
  await root.setValue(key, "ok");
  assert.equal(await root.getValue(key), "ok");

  await session.abort();
});
