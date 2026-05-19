# Object Mapping

`gemstone-js` supports object mapping, but it keeps the GemStone object model
explicit. The library maps JavaScript values and TypeScript types to GemStone
calls and object handles; it does not automatically hydrate GemStone objects
into mutable JavaScript class instances.

That distinction is deliberate. GemStone objects have identity, session
affinity, transaction visibility, and remote selector-send semantics. Hiding
those behind plain JavaScript property reads would make common workflows look
simpler while making correctness harder to reason about.

## Mapping Layers

Use these layers according to how much object identity you need to preserve:

- **Value marshalling**: `performWith()`, `performValueWith()`,
  `ManagedOop.send()`, arrays, and dictionaries convert common JavaScript
  values into GemStone objects and marshal simple results back.
- **Raw identity**: `Oop` is the branded `bigint` handle for a GemStone object.
  Use raw OOP APIs when you need exact identity or want to avoid result
  marshalling.
- **Retained typed handles**: `TypedOop<T>` keeps a GemStone object retained for
  the session and gives TypeScript a compile-time witness for the expected
  domain type.
- **Class references**: `Session.classRef<T>()` caches class lookup and exposes
  class-side sends, allocation, and object-returning sends.
- **Generated wrappers**: codegen manifests and decorated source emit typed
  functions that call GemStone selectors and return values, raw OOPs, or
  retained typed handles.
- **Dictionary payloads**: `objectToDictionaryArgument()` converts plain
  objects or class instances into explicit `StringKeyValueDictionary` payloads
  before persistence or selector sends.
- **Value converters**: `ValueConverterRegistry` lets sessions marshal richer
  scalar values such as `Date` without changing the default persistence
  contract.

## Typed Object Handles

Use `TypedOop<T>` when a GemStone selector returns a live object and you want
TypeScript to remember the expected domain shape.

```ts
import { Session, type TypedOop } from "gemstone-js";

interface Booking {
  id: string;
  status: string;
}

const session = await Session.connect();
const booking: TypedOop<Booking> = await session
  .classRef<Booking>("Booking")
  .sendObject("find:", "B-1001");

const status = await booking.send<string>("status");
await booking.send("status:", "confirmed");
await session.commit();
await booking.release();
```

This is object mapping through a retained remote handle. The `Booking` type is a
compile-time witness for the handle; it is not a hydrated local instance.
Selectors still make remote calls, and writes still follow the active GemStone
transaction.

## Generated Selector Wrappers

Generated wrappers are the most ergonomic mapping layer for application code.
The manifest or decorator source declares the GemStone class, selector,
argument types, and return kind. The generated function keeps the selector send
explicit while giving callers a typed API.

```json
{
  "functions": [
    {
      "exportedName": "findBooking",
      "className": "Booking",
      "selector": "find:",
      "argNames": ["id"],
      "argTypes": ["string"],
      "returnType": "TypedOop<Booking>",
      "returnKind": "object"
    }
  ]
}
```

The generated output calls `classRef().sendObject()`:

```ts
export async function findBooking(
  session: Session,
  id: string,
): Promise<TypedOop<Booking>> {
  return session.classRef("Booking").sendObject("find:", id);
}
```

Use `returnKind: "value"` for simple marshalled values, `returnKind: "oop"` for
raw object identity, and `returnKind: "object"` for retained typed handles.

## Explicit Dictionary Payloads

When you want to persist or pass a JavaScript object as structured data, convert
it explicitly into a dictionary argument.

```ts
import {
  Session,
  objectToDictionaryArgument,
  scalarValueConverterRegistry,
} from "gemstone-js";

class BookingDraft {
  constructor(
    public id: string,
    public status: string,
    public requestedAt: Date,
  ) {}
}

const session = await Session.connect({
  valueConverters: scalarValueConverterRegistry(),
});

const draft = new BookingDraft("B-1001", "held", new Date("2026-05-19T12:00:00Z"));
const payload = objectToDictionaryArgument(draft);

const booking = await session
  .classRef<Booking>("Booking")
  .sendObject("createFromDictionary:", payload);
```

This mirrors the explicit `dataclass_to_dict()` style used in `gemstone-py`.
Class instances become dictionary payloads only when the caller opts in.

## Value Converters

Converters run before built-in argument marshalling. They are best for scalar
domain values that should cross the GemStone boundary in a consistent form.

```ts
import { Session, scalarValueConverterRegistry } from "gemstone-js";

const session = await Session.connect({
  valueConverters: scalarValueConverterRegistry(),
});

await session.classRef("AuditLog").send("recordAt:", new Date());
```

The built-in scalar registry stores `Date` values as ISO strings. Custom
converters can add application-specific scalar wrappers while keeping object
graph persistence explicit.

## Readback and Inspection

For simple data structures, use bounded value readback:

```ts
const values = await session.arrayOopToValues(arrayOop, {
  maxDepth: 4,
  maxTotalItems: 500,
});

const dict = await session.dictionaryOopToObject(dictOop, {
  maxEntries: 100,
});
```

For live GemStone objects, prefer retained handles and inspection:

```ts
const object = session.typedOop<Booking>(bookingOop);
const summary = await object.inspect();
const dump = await object.dump({ maxDepth: 2, maxItems: 50 });
```

Bounded readback protects callers from unexpectedly large collections or deep
object graphs. Inspection keeps object identity visible instead of pretending
the remote object is a plain local value.

## What Is Not Automatic

`gemstone-js` does not currently provide:

- transparent `booking.status` property dispatch to GemStone selectors
- automatic JS class hydration from arbitrary GemStone instances
- a session-wide identity map for local wrapper instances
- automatic persistence of arbitrary JavaScript object graphs
- lazy slot loading hidden behind synchronous property access

Those features can be useful in narrow domains, but they also create sharp
edges around transactions, remote latency, conflict handling, and object
identity. The current object-mapping API keeps those boundaries reviewable.

