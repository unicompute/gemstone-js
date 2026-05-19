import assert from "node:assert/strict";
import test from "node:test";

import {
  Session,
  mappedObject,
  type MappedObject,
  type Oop,
  type TypedOop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

interface Booking {
  id: string;
  status: string;
}

test("mappedObject exposes async property-style selector methods", async () => {
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    perform(_receiver, selector, args) {
      if (selector === "status") return runtime.strings.get("held") as Oop;
      if (selector === "status:") return args[0];
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("held");
  await session.newString("unknown");
  const booking = mappedObject<Booking, { setStatus(status: string): Promise<unknown> }>(
    session.typedOop<Booking>(runtime.allocate()),
  );

  assert.equal(await booking.status(), "held");
  assert.equal(await booking.$send("status"), "held");
  assert.equal(await booking.setStatus("confirmed"), booking);

  const performSelectors = runtime.calls
    .filter((call) => call.method === "perform")
    .map((call) => call.args[1]);
  assert.deepEqual(performSelectors.slice(-3), ["status", "status", "status:"]);

  await booking.$release();
  await session.logout();
});

test("mappedObject supports explicit selectors, object returns, and snapshots", async () => {
  let runtime: MockGciRuntime;
  const customerOop = 0x7000n as Oop;
  runtime = new MockGciRuntime({
    perform(_receiver, selector) {
      if (selector === "bookingId") return runtime.strings.get("B-1001") as Oop;
      if (selector === "currentStatus") return runtime.strings.get("confirmed") as Oop;
      if (selector === "customer") return customerOop;
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("B-1001");
  await session.newString("confirmed");
  await session.newString("unknown");
  const booking = mappedObject<
    Booking,
    {
      customer(): Promise<TypedOop<{ name: string }>>;
      currentStatus(): Promise<string>;
    }
  >(session.typedOop<Booking>(runtime.allocate()), {
    selectors: {
      id: "bookingId",
      status: "currentStatus",
      currentStatus: "currentStatus",
    },
    objectSelectors: {
      customer: "customer",
    },
    snapshot: ["id", "status"],
  });

  assert.equal(await booking.id(), "B-1001");
  assert.equal(await booking.currentStatus(), "confirmed");
  const customer = await booking.customer();
  assert.equal(customer.oop, customerOop);
  assert.deepEqual(await booking.$snapshot(), { id: "B-1001", status: "confirmed" });

  await customer.release();
  await booking.$release();
  await session.logout();
});

test("mappedObject snapshots dictionary fields with readback bounds", async () => {
  let runtime: MockGciRuntime;
  let detailsOop = 0n as Oop;
  runtime = new MockGciRuntime({
    execute(source) {
      assert(source.includes(`Object _objectForOop: ${detailsOop.toString()}.`));
      return runtime.newString("channel\nstatus\n");
    },
    perform(_receiver, selector) {
      if (selector === "details") return detailsOop;
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("unknown");
  detailsOop = await session.dictionaryToOop({ channel: "web", status: "ready" });
  const booking = mappedObject(session.typedOop(runtime.allocate()), {
    snapshot: {
      details: { selector: "details", kind: "dict", maxEntries: 10 },
    },
  });

  assert.deepEqual(await booking.$snapshot(), {
    details: { channel: "web", status: "ready" },
  });

  await booking.$release();
  await session.logout();
});

test("mappedObject rejects ambiguous multi-argument selector inference", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const booking = mappedObject(session.typedOop(runtime.allocate()));

  await assert.rejects(
    () => (booking as unknown as { update(a: string, b: string): Promise<unknown> }).update("a", "b"),
    /Cannot infer GemStone selector/,
  );

  await booking.$release();
  await session.logout();
});
