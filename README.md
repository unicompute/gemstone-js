# gemstone-js

`gemstone-js` is the TypeScript bridge to GemStone/S described in
`../plan.js.txt`.

This initial slice locks in the public async API, OOP encoding helpers, runtime
dispatch layer, test mock, session/pool scaffolding, and a separate
`@gemstone-js/native` napi-rs starter. The live GCI implementation is in the
native package; the TypeScript package can be tested locally with a mock runtime.

## Current Status

- Async-first API: `Session.connect()`, `execute()`, `perform()`,
  `withTransaction()` with sync or async callbacks, and `AsyncDisposable`
  support.
- High-level argument marshalling through `performWith()` and
  `ManagedOop.send()`: strings become GemStone strings, numbers become
  SmallIntegers or Floats, bigints become SmallIntegers, booleans/null become
  immediate OOPs, arrays become GemStone `Array` objects, plain objects become
  `StringKeyValueDictionary`, and managed handles pass their retained OOP.
- `Session.classRef()` gives an explicit typed class handle for class-side
  sends, object-returning sends, allocation, and wrapping returned OOPs without
  hiding async remote calls behind JavaScript property access.
- Runtime adapters: Node (`@gemstone-js/native`), Deno FFI starter, Bun FFI
  starter, and a mock runtime for tests.
- Runtime library discovery follows `libPath`, `GS_LIB_PATH`, `GS_LIB`, then
  `GEMSTONE/lib` for the Deno and Bun FFI adapters.
- Deno and Bun FFI adapters now marshal pointer-buffer calls for `perform()`,
  `fetchBytes()`, float conversion, `GciErr`, and dictionary lookups through
  shared typed array helpers.
- OOP helpers ported from `gemstone-rs/crates/gemstone-gci`.
- Low-level allocation/fetch helpers: `newOop()`, `fetchClass()`,
  `fetchSize()`, `fetchBytes()`, `arrayToOop()`, `arrayOopToValues()`, and
  retained `array()` wrappers. Array readback accepts optional `maxDepth` and
  `maxItems`/`maxTotalItems` bounds to guard recursive or unexpectedly large
  arrays.
- Dictionary/global helpers: `dictionaryToOop()`, `strDictGet()`,
  `strDictSet()`, `globalGet()`, `globalGetObject()`, `globalHas()`,
  `globalKeys()`, `globalPick()`, raw `globalPickOop()`, `globalEntries()`,
  raw `globalEntriesOop()`, `globalValues()`, `globalItems()`, raw
  `globalValuesOop()`/`globalItemsOop()`, `globalSet()`/`globalSetAll()`, raw
  `globalSetOop()`/`globalSetAllOop()`, required global accessors, and
  `globalRemove()`/`globalDelete()`.
- `GsDict` wraps GemStone `StringKeyValueDictionary` objects with `get()`,
  `getObject()`, `set()`/`setAll()`, raw `setOop()`/`setAllOop()`,
  `remove()`/`delete()`, `has()`, `size()`, `isEmpty()`, `keys()`,
  `values()`, raw `valuesOop()`, `items()`, raw `itemsOop()`, `entries()`,
  raw `entriesOop()`, `pick()`, raw `pickOop()`, required raw/value/object
  accessors, explicit send helpers, and inspection helpers.
- `PersistentRoot` now has value helpers (`getValue()`, `setValue()`,
  `setAllValue()`, `getDict()`, `setDict()`), raw `setAll()`,
  `getObject()`, `remove()`/`delete()`, `has()`, `keys()`, `pick()`,
  raw `pickOop()`, `entries()`, raw `entriesOop()`, `values()`, raw
  `valuesOop()`, `items()`, raw `itemsOop()`, and required
  raw/value/object/dictionary access built on the session marshalling layer.
- Session pool release is reset-aware: dirty sessions are aborted before reuse,
  failed resets are discarded, waiters are served with replacement sessions, and
  close rejects pending acquires. Explicit validation queries run without
  needing a separate interval option, `warm()` is idempotent for target
  capacity, and `withSession()` wraps sync or async acquire/use/release
  callback flows.
- Result marshalling now converts GemStone `String` and `Symbol` objects back
  into JavaScript strings via `fetchString()` and class detection. Float OOPs are
  converted when the runtime reports that `GciOopToFlt_` succeeded.
- `Session.inspect()` and retained handle `inspect()`/`printString()` helpers
  return typed `oop`, `class`, `classOop`, `printString`, size/byte-size, class
  hierarchy, slot, and indexed-field metadata for quick debugging of raw object
  handles.
- `GSCollection.search()` unwraps result arrays into typed handles,
  `GSCollection.searchOop()` returns raw handles, `all()`/`allOop()` read the
  collection as object handles, `page()`/`pageOop()` fetch bounded array pages,
  `add()`/`addAll()` and raw `addOop()`/`addAllOop()` append values,
  `remove()`/`delete()` and raw `removeOop()`/`deleteOop()` remove members,
  `clear()` sends `removeAll`,
  `first()`/`firstOop()` return nullable first matches without materializing
  result arrays, `limit()`/`take()` fetch bounded predicate matches,
  `size()`/`isEmpty()` expose collection metadata, `count()` increments a
  counter without materializing selected matches, `exists()` early-exits with
  `detect:ifNone:`, and `GSCollection.iter()` fetches collection chunks while
  yielding individual objects. Equality-index helpers are available through both
  explicit
  `createEqualityIndexOn()`/`removeEqualityIndexOn()` and higher-level
  `createIndex()`/`removeIndex()` calls. Source-rendering helpers validate
  collection names, persistent-root names, and SymbolDictionary entry names
  before emitting Smalltalk; see `docs/naming.md` for the shared policy.
- Pool, observability hooks, persistent-root, query, codegen, and Express,
  Fastify, and Hono adapter scaffolds.
- Codegen helpers render wrappers that share the same JavaScript argument
  marshalling as hand-written calls and can return marshalled values, raw OOPs,
  or retained typed object handles. Generated selectors are checked for keyword
  shape and argument arity before source is emitted; manifests also reject
  malformed function entries and duplicate exported wrapper names.
- Codegen manifests have a published JSON Schema at
  `schemas/codegen-manifest.schema.json`, can include typed signatures/imports,
  and can be produced from decorated source with `npm run codegen:scan --`.
  The scanner uses the TypeScript parser for decorators, decorator aliases,
  namespace decorators from `gemstone-js`, overload signatures, multiline
  methods, generics, and default, namespace, and aliased typed imports, and infers raw
  OOP/object-returning wrappers from `Oop` and `TypedOop<T>` return
  annotations. Add `--module` to emit generated wrapper source directly from
  decorated classes.
- `npm run codegen -- [--check] <manifest.json> [output.ts]` renders wrapper
  modules from a JSON manifest and can verify checked-in generated files in CI;
  see `examples/codegen.manifest.json` and `examples/codegen.generated.ts`.
  Manifest imports support direct `typeNames`, default `typeDefaultName`,
  aliased `typeSpecifiers`, and namespace `typeNamespaceName` imports.
- `examples/booking.decorators.ts` is a committed scanner fixture; CI verifies
  that it still renders `examples/booking.decorators.generated.ts`.
- `Session.performObjectWith()` and `sendValue()` aliases make value, raw OOP,
  and retained object-returning sends explicit at both session and class-ref
  layers.
- `InMemoryMetrics` and `InMemoryTracer` make observability behavior easy to
  assert in tests and examples.

## Local Smoke Test

```sh
npm run verify
```

Node 24 can execute the `.ts` tests directly using built-in type stripping.
The package check verifies both checked-in generated outputs, then uses
`npm pack --dry-run` with a disposable cache and verifies that the publishable
tarball includes docs/examples while excluding tests and local build metadata.

Live GemStone checks are opt-in:

```sh
GS_RUN_LIVE=1 npm run test:live
```

The live smoke covers connect, execute, class-side sends, `performWith()`,
string, float, nested array marshalling/readback, global
lookup/enumeration/required/raw set/removal helpers, `GsDict` metadata,
value/raw enumeration, required-read, and removal helpers, and `PersistentRoot`
value, dictionary, key, pick, required-value, batch-value, and removal helpers.
It also covers live query add/remove, `count()`, `exists()`, `first()`,
`limit()`, and index create/remove when the backing collection supports
GemStone index selectors.

## Example

```ts
import { Session } from "gemstone-js";

await using session = await Session.connect({
  username: process.env.GS_USERNAME,
  password: process.env.GS_PASSWORD,
});

const oop = await session.execute("1 + 1");
console.log(oop);
```

## Runtime Notes

Node uses `@gemstone-js/native`, which is scaffolded in `../gemstone-js-native`
and is intended to expose napi-rs bindings over the shared `gemstone-gci` Rust
crate.

Deno and Bun adapters declare the GCI symbols directly with their built-in FFI
systems. Pointer-array and out-parameter calls are wired through typed arrays;
`GciErr` is decoded into the same `GciErrorInfo` shape used by the Node adapter.
Live-runtime hardening is still needed around platform coverage.
