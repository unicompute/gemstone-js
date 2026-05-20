import assert from "node:assert/strict";
import test from "node:test";

import {
  Session,
  smalltalkBridge,
  smalltalkObject,
  smalltalkSelectorForProperty,
  type Oop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";
import { smallintToOop } from "../src/oop.ts";

test("smalltalkSelectorForProperty maps JS-friendly names to Smalltalk selectors", () => {
  assert.equal(smalltalkSelectorForProperty("size"), "size");
  assert.equal(smalltalkSelectorForProperty("new_"), "new:");
  assert.equal(smalltalkSelectorForProperty("at_put_"), "at:put:");
  assert.equal(smalltalkSelectorForProperty("removeKey_ifAbsent_"), "removeKey:ifAbsent:");
  assert.throws(() => smalltalkSelectorForProperty("__proto__"), /Invalid Smalltalk selector/);
});

test("smalltalkBridge resolves globals lazily and dispatches selectors", async () => {
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    perform(_receiver, selector, args) {
      if (selector === "name") return runtime.strings.get("SystemRepository") as Oop;
      if (selector === "new:") {
        assert.deepEqual(args, [smallintToOop(3)]);
        return runtime.strings.get("Array(3)") as Oop;
      }
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("SystemRepository");
  await session.newString("Array(3)");
  await session.newString("unknown");

  const st = smalltalkBridge(session);
  assert.equal(await st.SystemRepository.name(), "SystemRepository");
  assert.equal(await st.SystemRepository.name, "SystemRepository");
  assert.equal(await st.Array.new_(3), "Array(3)");
  assert.equal(await st.$send("SystemRepository", "name"), "SystemRepository");

  const resolveNames = runtime.calls
    .filter((call) => call.method === "resolveSymbol")
    .map((call) => call.args[0]);
  assert.deepEqual(resolveNames.filter((name) => name === "SystemRepository"), ["SystemRepository"]);
  assert(resolveNames.includes("Array"));

  await session.logout();
});

test("smalltalkBridge supports raw and retained object result modes", async () => {
  let runtime: MockGciRuntime;
  const bookingOop = 0x7000n as Oop;
  runtime = new MockGciRuntime({
    perform(_receiver, selector) {
      if (selector === "find:") return bookingOop;
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("unknown");

  const st = smalltalkBridge(session);
  assert.equal(await st.BookingRepository.find_.oop("B-1001"), bookingOop);
  const booking = await st.BookingRepository.find_.object<{ status: string }>("B-1001");
  assert.equal(booking.oop, bookingOop);

  await booking.release();
  await session.logout();
});

test("smalltalkBridge can wrap selector object results as transparent proxies", async () => {
  let runtime: MockGciRuntime;
  const bookingOop = 0x7100n as Oop;
  runtime = new MockGciRuntime({
    perform(_receiver, selector, args) {
      if (selector === "find:") {
        assert.deepEqual(args, [runtime.strings.get("B-1001") as Oop]);
        return bookingOop;
      }
      if (selector === "status") return runtime.strings.get("held") as Oop;
      if (selector === "status:reason:") {
        assert.deepEqual(args, [
          runtime.strings.get("confirmed") as Oop,
          runtime.strings.get("deposit received") as Oop,
        ]);
        return runtime.strings.get("confirmed") as Oop;
      }
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("B-1001");
  await session.newString("held");
  await session.newString("confirmed");
  await session.newString("deposit received");
  await session.newString("unknown");

  type BookingMethods = {
    updateStatus(status: string, reason: string): Promise<string>;
  };
  const st = smalltalkBridge(session);
  const booking = await st.BookingRepository.find_.transparent<{ status: string }>("B-1001");
  const bookingWithMethods = await st.BookingRepository.find_.transparentWith<
    { status: string },
    BookingMethods
  >(
    { selectors: { updateStatus: "status:reason:" } },
    "B-1001",
  );

  assert.equal(await booking.status, "held");
  assert.equal(await bookingWithMethods.updateStatus("confirmed", "deposit received"), "confirmed");

  await booking.$release();
  await bookingWithMethods.$release();
  await session.logout();
});

test("smalltalkBridge caches globals and can clear cache", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const st = smalltalkBridge(session);

  const first = await st.Object.$oop();
  const second = await st.Object.$oop();
  assert.equal(first, second);

  st.$clearCache("Object");
  assert.equal(await st.Object.$oop(), first);

  const objectResolves = runtime.calls
    .filter((call) => call.method === "resolveSymbol" && call.args[0] === "Object");
  assert.equal(objectResolves.length, 2);

  await session.logout();
});

test("smalltalkObject can wrap a known OOP and create transparent object proxies", async () => {
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    perform(_receiver, selector) {
      if (selector === "status") return runtime.strings.get("held") as Oop;
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("held");
  await session.newString("unknown");
  const oop = runtime.allocate();
  const object = smalltalkObject(session, oop, "Booking");

  assert.equal(await object.status, "held");
  const transparent = await object.$transparent<{ status: string }>();
  assert.equal(await transparent.status, "held");

  await transparent.$release();
  await session.logout();
});
