import {
  GemStoneClass,
  GemStoneSelector,
  inferGeneratedReturnKind,
  metadataFor,
  OOP_FALSE,
  renderGeneratedFunction,
  renderGeneratedModule,
  sendGenerated,
  Session,
  smallintToOop,
  type Oop,
  type TypedOop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

const registeredTests: Array<() => Promise<void>> = [];

test("sendGenerated uses the standard argument marshalling path", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  await sendGenerated(session, "Booking", "find:active:count:", ["Ada", false, 3]);

  const perform = runtime.calls.findLast((call) => call.method === "perform");
  if (!perform) throw new Error("sendGenerated should call perform");
  const args = perform.args[2] as unknown[];

  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "Ada"), "string arguments should use newString");
  assertEqual(args[1], OOP_FALSE);
  assertEqual(args[2], smallintToOop(3));

  await session.logout();
});

test("sendGenerated can return raw OOPs without result marshalling", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const raw = await sendGenerated(session, "Booking", "find:", ["B-1"], "oop");

  assertEqual(raw, 0x3000n as Oop);
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "B-1"), "raw wrappers should still marshal arguments");
  assert(!runtime.calls.some((call) => call.method === "fetchClass"), "raw wrappers should not marshal the return value");

  await session.logout();
});

test("sendGenerated can return retained typed object handles", async () => {
  const runtime = new MockGciRuntime();
  const session = await Session.connect({ username: "u", password: "p", runtime });

  const found: TypedOop<{ id: string }> = await sendGenerated<{ id: string }>(session, "Booking", "find:", ["B-2"], "object");

  assertEqual(found.session, session);
  assertEqual(found.oop, 0x3000n as Oop);
  assert(runtime.calls.some((call) => call.method === "newString" && call.args[0] === "B-2"), "object wrappers should still marshal arguments");

  await found.release();
  assert(runtime.calls.some((call) => call.method === "addOopToExportSet" && call.args[0] === found.oop), "object wrappers should retain the returned handle");
  await session.logout();
});

test("renderGeneratedFunction emits value-returning wrappers without dangling parameters", () => {
  assertEqual(renderGeneratedFunction({
    exportedName: "currentStatus",
    className: "Booking",
    selector: "currentStatus",
    argNames: [],
  }), [
    "export async function currentStatus(session) {",
    "  const receiver = await session.resolveSymbol(\"Booking\");",
    "  return session.performValueWith(receiver, \"currentStatus\");",
    "}",
    "",
  ].join("\n"));

  assertEqual(renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:active:",
    argNames: ["id", "active"],
  }), [
    "export async function findBooking(session, id, active) {",
    "  const receiver = await session.resolveSymbol(\"Booking\");",
    "  return session.performValueWith(receiver, \"find:active:\", id, active);",
    "}",
    "",
  ].join("\n"));
});

test("renderGeneratedFunction emits raw-OOP and object-returning wrappers", () => {
  assertEqual(renderGeneratedFunction({
    exportedName: "rawBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    returnKind: "oop",
  }), [
    "export async function rawBooking(session, id) {",
    "  const receiver = await session.resolveSymbol(\"Booking\");",
    "  return session.performWith(receiver, \"find:\", id);",
    "}",
    "",
  ].join("\n"));

  assertEqual(renderGeneratedFunction({
    exportedName: "findBookingObject",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    returnKind: "object",
  }), [
    "export async function findBookingObject(session, id) {",
    "  return session.classRef(\"Booking\").sendObject(\"find:\", id);",
    "}",
    "",
  ].join("\n"));
});

test("generated wrappers infer raw-OOP and object return calls from return types", () => {
  assertEqual(inferGeneratedReturnKind(undefined), "value");
  assertEqual(inferGeneratedReturnKind("string"), "value");
  assertEqual(inferGeneratedReturnKind("Oop"), "oop");
  assertEqual(inferGeneratedReturnKind("Gem.Oop"), "oop");
  assertEqual(inferGeneratedReturnKind("TypedOop<Booking>"), "object");
  assertEqual(inferGeneratedReturnKind("TypedOop < Booking >"), "object");
  assertEqual(inferGeneratedReturnKind("Gem.TypedOop<Booking>"), "object");

  assertEqual(renderGeneratedFunction({
    exportedName: "rawBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    argTypes: ["string"],
    sessionType: "Session",
    returnType: "Oop",
  }), [
    "export async function rawBooking(session: Session, id: string): Promise<Oop> {",
    "  const receiver = await session.resolveSymbol(\"Booking\");",
    "  return session.performWith(receiver, \"find:\", id);",
    "}",
    "",
  ].join("\n"));

  assertEqual(renderGeneratedFunction({
    exportedName: "findBookingObject",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    argTypes: ["string"],
    sessionType: "Session",
    returnType: "TypedOop<Booking>",
  }), [
    "export async function findBookingObject(session: Session, id: string): Promise<TypedOop<Booking>> {",
    "  return session.classRef(\"Booking\").sendObject(\"find:\", id);",
    "}",
    "",
  ].join("\n"));

  assertEqual(renderGeneratedFunction({
    exportedName: "findBookingObject",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    argTypes: ["string"],
    sessionType: "Gem.Session",
    returnType: "Gem.TypedOop<Booking>",
  }), [
    "export async function findBookingObject(session: Gem.Session, id: string): Promise<Gem.TypedOop<Booking>> {",
    "  return session.classRef(\"Booking\").sendObject(\"find:\", id);",
    "}",
    "",
  ].join("\n"));
});

test("renderGeneratedFunction allows binary selectors with one argument", () => {
  assertEqual(renderGeneratedFunction({
    exportedName: "addBooking",
    className: "BookingCounter",
    selector: "+",
    argNames: ["other"],
    returnKind: "oop",
  }), [
    "export async function addBooking(session, other) {",
    "  const receiver = await session.resolveSymbol(\"BookingCounter\");",
    "  return session.performWith(receiver, \"+\", other);",
    "}",
    "",
  ].join("\n"));
});

test("renderGeneratedModule emits stable multi-wrapper source", () => {
  assertEqual(renderGeneratedModule({
    functions: [
      {
        exportedName: "currentStatus",
        className: "Booking",
        selector: "currentStatus",
        argNames: [],
      },
      {
        exportedName: "findBookingObject",
        className: "Booking",
        selector: "find:",
        argNames: ["id"],
        returnKind: "object",
      },
    ],
  }), [
    "// Generated by gemstone-js codegen. Do not edit.",
    "",
    "export async function currentStatus(session) {",
    "  const receiver = await session.resolveSymbol(\"Booking\");",
    "  return session.performValueWith(receiver, \"currentStatus\");",
    "}",
    "",
    "export async function findBookingObject(session, id) {",
    "  return session.classRef(\"Booking\").sendObject(\"find:\", id);",
    "}",
    "",
  ].join("\n"));

  assertEqual(renderGeneratedModule({
    banner: false,
    functions: [{
      exportedName: "rawBooking",
      className: "Booking",
      selector: "find:",
      argNames: ["id"],
      returnKind: "oop",
    }],
  }), [
    "export async function rawBooking(session, id) {",
    "  const receiver = await session.resolveSymbol(\"Booking\");",
    "  return session.performWith(receiver, \"find:\", id);",
    "}",
    "",
  ].join("\n"));
});

test("renderGeneratedModule emits imports and typed wrapper signatures", () => {
  assertEqual(renderGeneratedModule({
    imports: [
      { from: "gemstone-js", typeNames: ["Session", "TypedOop"] },
      { from: "./booking-query.ts", typeDefaultName: "BookingQuery" },
      { from: "./booking-types.ts", typeNamespaceName: "BookingTypes" },
    ],
    functions: [{
      exportedName: "findBookingObject",
      className: "Booking",
      selector: "find:query:",
      argNames: ["id", "query"],
      argTypes: ["string", "BookingQuery"],
      sessionType: "Session",
      returnType: "TypedOop<BookingTypes.Booking>",
      returnKind: "object",
    }],
  }), [
    "// Generated by gemstone-js codegen. Do not edit.",
    "",
    "import type { Session, TypedOop } from \"gemstone-js\";",
    "import type BookingQuery from \"./booking-query.ts\";",
    "import type * as BookingTypes from \"./booking-types.ts\";",
    "",
    "export async function findBookingObject(session: Session, id: string, query: BookingQuery): Promise<TypedOop<BookingTypes.Booking>> {",
    "  return session.classRef(\"Booking\").sendObject(\"find:query:\", id, query);",
    "}",
    "",
  ].join("\n"));
});

test("renderGeneratedModule rejects invalid manifests", () => {
  assertThrows(() => renderGeneratedModule(null as never));
  assertThrows(() => renderGeneratedModule([] as never));
  assertThrows(() => renderGeneratedModule({ functions: "oops" as never }));
  assertThrows(() => renderGeneratedModule({ functions: [], extra: true } as never));
  assertThrows(() => renderGeneratedModule({ $schema: 42, functions: [] } as never));
  assertThrows(() => renderGeneratedModule({ banner: 42, functions: [] } as never));
  assertThrows(() => renderGeneratedModule({ imports: "oops" as never, functions: [] }));
  assertThrows(() => renderGeneratedModule({
    imports: [{ from: "gemstone-js", typeNames: ["Session", "Session"] }],
    functions: [],
  }));
  assertThrows(() => renderGeneratedModule({
    imports: [{ from: "gemstone-js", typeNames: ["Session"], extra: true }],
    functions: [],
  } as never));
  assertThrows(() => renderGeneratedModule({
    imports: [{ from: "gemstone-js", typeSpecifiers: [{ name: "Session", alias: "Session" }], typeNames: ["Session"] }],
    functions: [],
  }));
  assertThrows(() => renderGeneratedModule({
    imports: [{ from: "gemstone-js", defaultName: "GemStone", namespaceName: "GemStone" }],
    functions: [],
  }));
  assertThrows(() => renderGeneratedModule({
    imports: [{ from: "gemstone-js", defaultName: "Session", typeNames: ["Session"] }],
    functions: [],
  }));
  assertThrows(() => renderGeneratedModule({
    imports: [{ from: "gemstone-js", namespaceName: "GemStone", typeNamespaceName: "GemStone" }],
    functions: [],
  }));
  assertThrows(() => renderGeneratedModule({
    imports: [{ from: "gemstone-js", defaultName: "Booking", typeDefaultName: "Booking" }],
    functions: [],
  }));
  assertThrows(() => renderGeneratedModule({
    imports: [{ from: "gemstone-js", typeSpecifiers: [
      { name: "Session", alias: "GSSession" },
      { name: "TypedOop", alias: "GSSession" },
    ] }],
    functions: [],
  }));
  assertThrows(() => renderGeneratedModule({
    imports: [{ from: "gemstone-js", namespaceName: "GemStone", names: ["Session"] }],
    functions: [],
  }));
  assertThrows(() => renderGeneratedModule({
    functions: [
      {
        exportedName: "findBooking",
        className: "Booking",
        selector: "find:",
        argNames: ["id"],
      },
      {
        exportedName: "findBooking",
        className: "Booking",
        selector: "find:active:",
        argNames: ["id", "active"],
      },
    ],
  }));
});

test("renderGeneratedFunction rejects unsafe JavaScript identifiers", () => {
  assertThrows(() => renderGeneratedFunction(null as never));
  assertThrows(() => renderGeneratedFunction({
    exportedName: 42 as never,
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: "id" as never,
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: [42] as never,
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    extra: true,
  } as never));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    argTypes: [],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    argTypes: { other: "string" },
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    returnType: "string; process.exit()",
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "bad;name",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["class"],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:again:",
    argNames: ["id", "id"],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    returnKind: "record" as never,
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "rawBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    returnType: "Oop",
    returnKind: "value",
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBookingObject",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    returnType: "TypedOop<Booking>",
    returnKind: "oop",
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: ["id"],
    returnType: "string",
    returnKind: "object",
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "",
    selector: "find:",
    argNames: ["id"],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "",
    argNames: [],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:",
    argNames: [],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:active:",
    argNames: ["id"],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "currentStatus",
    className: "Booking",
    selector: "currentStatus",
    argNames: ["id"],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "addBooking",
    className: "BookingCounter",
    selector: "+",
    argNames: [],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find:active",
    argNames: ["id"],
  }));
  assertThrows(() => renderGeneratedFunction({
    exportedName: "findBooking",
    className: "Booking",
    selector: "find::",
    argNames: ["id", "active"],
  }));
});

test("decorator helpers retain class and selector metadata", () => {
  class Booking {}

  GemStoneSelector("markPaidAt:")(Booking.prototype, "markPaidAt", undefined as never);
  GemStoneClass("OkzBooking")(Booking);

  const metadata = metadataFor(Booking);
  if (!metadata) throw new Error("GemStoneClass should register metadata");
  assertEqual(metadata.className, "OkzBooking");
  assertEqual(metadata.selectors.get("markPaidAt"), "markPaidAt:");
});

for (const run of registeredTests) {
  await run();
}

function test(name: string, fn: () => void | Promise<void>): void {
  registeredTests.push(async () => {
    try {
      await fn();
    } catch (error) {
      if (error instanceof Error) {
        error.message = `${name}: ${error.message}`;
      }
      throw error;
    }
  });
}

function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertThrows(fn: () => unknown): void {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error("expected function to throw");
}
