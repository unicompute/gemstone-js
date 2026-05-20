import assert from "node:assert/strict";
import test from "node:test";

import {
  Session,
  mappedObject,
  transparentObject,
  TransparentObjectMapper,
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

test("transparentObject exposes awaitable selector properties and callable sends", async () => {
  let runtime: MockGciRuntime;
  const customerOop = 0x7100n as Oop;
  runtime = new MockGciRuntime({
    perform(_receiver, selector, args) {
      if (selector === "status") return runtime.strings.get("held") as Oop;
      if (selector === "status:reason:") return runtime.strings.get(`${args.length}`) as Oop;
      if (selector === "customer") return customerOop;
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("held");
  await session.newString("2");
  await session.newString("unknown");
  const booking = transparentObject<
    Booking,
    {
      updateStatus(status: string, reason: string): Promise<string>;
      customer: PromiseLike<TypedOop<{ name: string }>>;
    }
  >(session.typedOop<Booking>(runtime.allocate()), {
    selectors: {
      updateStatus: "status:reason:",
    },
    objectSelectors: {
      customer: "customer",
    },
  });

  assert.equal(await booking.status, "held");
  assert.equal(await booking.status(), "held");
  assert.equal(await booking.updateStatus("confirmed", "deposit"), "2");
  const customer = await booking.customer;
  assert.equal(customer.oop, customerOop);

  await customer.release();
  await booking.$release();
  await session.logout();
});

test("transparentObject queues assignment writes and flushes errors explicitly", async () => {
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    perform(_receiver, selector, args) {
      if (selector === "status") return runtime.strings.get("held") as Oop;
      if (selector === "status:") return args[0];
      if (selector === "priority:") throw new Error("priority rejected");
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("held");
  await session.newString("unknown");
  const booking = transparentObject<Booking>(session.typedOop<Booking>(runtime.allocate()));

  (booking as unknown as { status: string }).status = "confirmed";
  assert.equal(await booking.status, "confirmed");
  await booking.$flush();

  (booking as unknown as { priority: number }).priority = 3;
  await assert.rejects(() => booking.$flush(), /priority rejected/);

  const performSelectors = runtime.calls
    .filter((call) => call.method === "perform")
    .map((call) => call.args[1]);
  assert(performSelectors.includes("status:"));
  assert(performSelectors.includes("priority:"));

  await booking.$release();
  await session.logout();
});

test("transparentObject supports cache refresh and bulk assignment", async () => {
  let runtime: MockGciRuntime;
  let reads = 0;
  runtime = new MockGciRuntime({
    perform(_receiver, selector, args) {
      if (selector === "status") {
        reads += 1;
        return runtime.strings.get(`held-${reads}`) as Oop;
      }
      if (selector === "status:") return args[0];
      return runtime.strings.get("unknown") as Oop;
    },
  });
  const session = await Session.connect({ username: "u", password: "p", runtime });
  await session.newString("held-1");
  await session.newString("held-2");
  await session.newString("unknown");
  const booking = transparentObject<Booking>(session.typedOop<Booking>(runtime.allocate()), {
    cache: true,
  });

  assert.equal(await booking.status, "held-1");
  assert.equal(await booking.status, "held-1");
  assert.equal(reads, 1);
  assert.equal(await booking.$refresh("status"), "held-2");
  await booking.$assign({ status: "confirmed" });
  assert.equal(await booking.status, "confirmed");

  await booking.$release();
  await session.logout();
});

test("TransparentObjectMapper reuses proxies per session and OOP", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });
  const oop = runtime.allocate();
  const mapper = new TransparentObjectMapper();
  const firstHandle = session.typedOop<Booking>(oop);
  const secondHandle = session.typedOop<Booking>(oop);

  const first = mapper.wrap<Booking>(firstHandle);
  const second = mapper.wrap<Booking>(secondHandle);
  assert.equal(first, second);
  assert.equal(mapper.delete(secondHandle), true);
  await secondHandle.release();

  const thirdHandle = session.typedOop<Booking>(oop);
  const third = mapper.wrap<Booking>(thirdHandle);
  assert.notEqual(first, third);

  await first.$release();
  await third.$release();
  await session.logout();
});
