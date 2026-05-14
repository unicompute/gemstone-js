import assert from "node:assert/strict";
import test from "node:test";

import {
  Session,
  ValueConverter,
  ValueConverterRegistry,
  dateAsIsoStringConverter,
  scalarValueConverterRegistry,
  smallintToOop,
  type Oop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

test("scalar value converters round-trip Date values through GemStone strings", async () => {
  const runtime = new MockGciRuntime();
  const registry = scalarValueConverterRegistry();
  const session = await Session.connect({ username: "u", password: "p", runtime, valueConverters: registry });
  const date = new Date("2026-05-14T12:34:56.789Z");

  const oop = await registry.toOop(session, date);
  const roundTrip = await registry.fromOop<Date>("date_iso_string", session, oop);

  assert.deepEqual(registry.names(), ["date_iso_string"]);
  assert.equal(roundTrip.toISOString(), date.toISOString());
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === date.toISOString()));

  await session.logout();
});

test("performWith uses configured value converters before default object marshalling", async () => {
  const runtime = new MockGciRuntime();
  const date = new Date("2026-05-14T00:00:00.000Z");
  const session = await Session.connect({
    username: "u",
    password: "p",
    runtime,
    valueConverters: new ValueConverterRegistry([dateAsIsoStringConverter()]),
  });

  await session.performWith(smallintToOop(99), "storeDate:", date);

  const stringCall = runtime.calls.find((call) => call.method === "newString" && call.args[0] === date.toISOString());
  assert(stringCall, "Date arguments should be converted to ISO strings");
  const perform = runtime.calls.findLast((call) => call.method === "perform");
  assert(perform, "performWith should call perform");
  const args = perform.args[2] as Oop[];
  assert.equal(args[0], runtime.strings.get(date.toISOString()));

  await session.logout();
});

test("array and dictionary argument marshalling use configured value converters recursively", async () => {
  let runtime: MockGciRuntime;
  const allocatedArrays: Oop[] = [];
  runtime = new MockGciRuntime({
    perform(_receiver, selector, args) {
      if (selector === "new:") {
        const array = runtime.allocate();
        allocatedArrays.push(array);
        return array;
      }
      if (selector === "at:put:") return args[1];
      return args[0] ?? smallintToOop(0);
    },
  });
  const date = new Date("2026-05-14T09:15:00.000Z");
  const session = await Session.connect({
    username: "u",
    password: "p",
    runtime,
    valueConverters: scalarValueConverterRegistry(),
  });

  await session.arrayToOop(["created", date]);
  const dict = await session.dictionaryToOop({ createdAt: date });

  assert.equal(allocatedArrays.length, 1);
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === date.toISOString()));
  assert.equal(await session.strDictGet(dict, "createdAt"), date.toISOString());

  await session.logout();
});

test("custom value converters can be copied, registered, and selected by name", async () => {
  class BookingId {
    readonly value: string;

    constructor(value: string) {
      this.value = value;
    }
  }

  const converter = new ValueConverter<BookingId>({
    name: "booking_id",
    matches: (value): value is BookingId => value instanceof BookingId,
    toOop: (session, value) => session.newString(value.value),
    fromOop: async (session, oop) => new BookingId(await session.fetchString(oop)),
  });
  const registry = new ValueConverterRegistry();
  registry.register(converter);
  const copy = registry.copy();
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime, valueConverters: copy });

  await session.performWith(smallintToOop(99), "findBooking:", new BookingId("B-123"));
  const oop = await copy.toOop(session, new BookingId("B-456"));
  const roundTrip = await copy.fromOop<BookingId>("booking_id", session, oop);

  assert.deepEqual(copy.names(), ["booking_id"]);
  assert.equal(roundTrip.value, "B-456");
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "B-123"));
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "B-456"));
  await assert.rejects(() => copy.toOop(session, { value: "B-789" }), /No value converter/);
  await assert.rejects(() => copy.fromOop("missing", session, oop), /missing/);

  await session.logout();
});
