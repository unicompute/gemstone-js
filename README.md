# gemstone-js

`gemstone-js` is the TypeScript bridge to GemStone/S described in
`../plan.js.txt`.

This initial slice locks in the public async API, OOP encoding helpers, runtime
dispatch layer, test mock, session/pool scaffolding, and a separate
`@gemstone-js/native` napi-rs starter. The live GCI implementation is in the
native package; the TypeScript package can be tested locally with a mock runtime.

## Current Status

- Async-first API: `Session.connect()`, `execute()`, `perform()`,
  typed/managed execute helpers, `withTransaction()` with sync or async
  callbacks, and `AsyncDisposable` support.
- High-level argument marshalling through `performWith()` and
  `ManagedOop.send()`: strings become GemStone strings, numbers become
  SmallIntegers or Floats, bigints become SmallIntegers, booleans/null become
  immediate OOPs, arrays become GemStone `Array` objects, plain objects become
  `StringKeyValueDictionary`, and managed handles pass their retained OOP.
- `Session.classRef()` gives an explicit typed class handle for class-side
  sends, object-returning sends, allocation, and wrapping returned OOPs without
  hiding async remote calls behind JavaScript property access. Class names use
  the same simple GemStone global-name validation policy as source-rendered
  helpers.
- Runtime adapters: Node (`@gemstone-js/native`), Deno FFI starter, Bun FFI
  starter, and a mock runtime for tests.
- Runtime library discovery follows `libPath`, `GS_LIB_PATH`, `GS_LIB`, then
  `GEMSTONE/lib` for the Deno and Bun FFI adapters.
- Deno and Bun FFI adapters now marshal pointer-buffer calls for `perform()`,
  `fetchBytes()`, float conversion, `GciErr`, and dictionary lookups through
  shared typed array helpers.
- OOP helpers ported from `gemstone-rs/crates/gemstone-gci`.
- Low-level allocation/fetch helpers: `newOop()`, `fetchClass()`,
  `fetchSize()`, `fetchBytes()`, `arrayToOop()`, `arrayOopToValues()`, raw
  `arrayOopToOops()`/`arrayOops()`, retained object
  `arrayOopToObjects()`/`arrayObjects()`, direct array
  `arraySize()`/`arrayIsEmpty()`/`arrayAt*()`/`arrayFirst*()`/`arrayLast*()`
  plus bounded `arrayPage*()`/`arrayTake*()`, batch `arrayPick*()`/`arraySetAll*()`
  helpers, and retained `array()` wrappers.
  Array value readback accepts optional `maxDepth`
  and `maxItems`/`maxTotalItems` bounds to guard recursive or unexpectedly
  large arrays; raw OOP readback accepts a `maxItems` bound.
- Dictionary/global helpers: `dictionaryToOop()`, `dictionaryOopToObject()`,
  `dictionaryValues()`, `dictionaryKeys()`, `dictionarySize()`,
  `dictionaryIsEmpty()`, `dictionaryEntries()`, `dictionaryItems()`,
  raw `dictionaryEntriesOop()`/`dictionaryItemsOop()`,
  value-list `dictionaryValueList()`, raw `dictionaryValueOops()`,
  direct dictionary `get`/`set`/`replace`/`remove`/`clear` plus
  `has`/`pick`/`require` helpers for raw, value, object, and nested-dictionary
  entries, `strDictGet()`, `strDictSet()`,
  `globalGet()`/`globalGetValue()`, `globalGetObject()`,
  `globalHas()`/`globalHasAll()`, `globalKeys()`, `globalPick()`, raw `globalPickOop()`,
  nullable object/dictionary `globalPickObject()`/`globalPickDict()`,
  `globalEntries()`, raw `globalEntriesOop()`, `globalValues()`, `globalItems()`, raw
  `globalValuesOop()`/`globalItemsOop()`,
  `globalSize()`/`globalIsEmpty()`,
  `globalSet()`/`globalSetValue()` and `globalSetAll()`/`globalSetAllValue()`, raw
  `globalSetOop()`/`globalSetAllOop()` plus object-named
  `globalSetObject()`/`globalSetAllObject()` aliases, required global accessors including
  object alias `globalRequire()` and `globalRequireAll*()` bulk variants,
  dictionary helpers `globalGetDict()`, `globalSetDict()`/`globalSetAllDict()`,
  `globalRequireDict()`/`globalRequireAllDict()`, and
  `globalRemove()`/`globalDelete()` plus bulk
  `globalRemoveAll()`/`globalDeleteAll()`.
- `GsDict` wraps GemStone `StringKeyValueDictionary` objects with
  `get()`/`getValue()`,
  `getObject()`, `set()`/`setValue()` and `setAll()`/`setAllValue()`, raw
  `setOop()`/`setAllOop()` plus object-named
  `setObject()`/`setAllObject()` aliases,
  `replaceAll()`/`replaceAllValue()`, raw `replaceAllOop()`, object-named
  `replaceAllObject()`, dictionary `replaceAllDict()`, `clear()`,
  `remove()`/`delete()`, `has()`, `size()`, `isEmpty()`, `keys()`,
  `values()`, raw `valuesOop()`, `items()`, raw `itemsOop()`, `entries()`,
  `toObject()`, raw `entriesOop()`, `pick()`, raw `pickOop()`,
  nullable object/dictionary `pickObject()`/`pickDict()`, bulk `hasAll()` and
  `removeAll()`/`deleteAll()`, required raw/value/object accessors plus object
  alias `require()` and `requireAll*()` bulk variants, nested dictionary helpers
  `getDict()`/`setDict()`/`setAllDict()`/`requireDict()`/`requireAllDict()`,
  explicit send helpers, and inspection helpers.
- `PersistentRoot` now has value helpers (`getValue()`, `setValue()`,
  `setAllValue()`, `getDict()`, `setDict()`/`setAllDict()`), raw `setAll()`,
  explicit `setOop()`/`setAllOop()` and object-named
  `setObject()`/`setAllObject()` aliases, `getObject()`,
  `remove()`/`delete()`, `removeAll()`/`deleteAll()`, `has()`,
  `hasAll()`, `keys()`, `pick()`, raw `pickOop()`, nullable
  object/dictionary `pickObject()`/`pickDict()`, `entries()`, raw
  `entriesOop()`, `values()`, raw `valuesOop()`, `items()`, raw `itemsOop()`,
  `size()`/`isEmpty()`, and required raw/value/object/dictionary access plus
  `requireAll*()` bulk variants built on the session marshalling layer. Static
  constructors expose `UserGlobals`, `Globals`, `Published`, and
  `SessionMethods` roots using the same names as gemstone-py.
- `GStore` provides a session-bound, named JSON key/value store under
  `UserGlobals.GStoreRoot`, with async transaction callbacks, read-only
  snapshots, delete/remove helpers, and commit-conflict retry for conflict-like
  commit failures.
- Session pool release is reset-aware: dirty sessions are aborted before reuse,
  failed resets are discarded, waiters are served with replacement sessions, and
  close rejects pending acquires. Explicit validation queries run without
  needing a separate interval option, `warm()` is idempotent for target
  capacity, and `withSession()` wraps sync or async acquire/use/release
  callback flows.
- Result marshalling now converts GemStone `String` and `Symbol` objects back
  into JavaScript strings via `fetchString()` and class detection. Float OOPs are
  converted when the runtime reports that `GciOopToFlt_` succeeded.
- `Session.inspect()`, bounded recursive `dump()`, direct `printString()`,
  `describeClass()`, class-ref `describe()`, and retained handle
  `inspect()`/`dump()`/`printString()` helpers
  return typed `oop`, `class`, `classOop`, `printString`, size/byte-size, class
  hierarchy, slot, indexed-field, superclass, class instance-variable, and
  instance-count metadata for quick debugging of raw object handles and classes.
- `ObjectLog` wraps GemStone `ObjectLogEntry` with async add, read, level
  filter, size, clear, and delete helpers. Batched entry fetches use the same
  escaped row parser shape as `gemstone-py`.
- `GSCollection.search()` unwraps result arrays into typed handles,
  `GSCollection.searchOop()` returns raw handles, `all()`/`allOop()` read the
  collection as object handles, value helpers such as `allValues()`,
  `pageValues()`, `searchValues()`, `limitValues()`, `firstValue()`,
  `iterValues()`, and item value helpers marshal result objects directly,
  `page()`/`pageOop()` fetch bounded array pages,
  `at()`/`itemAt()` and raw `atOop()`/`itemAtOop()` read nullable 1-based
  indexed items,
  `firstItem()`/`lastItem()` and raw `firstItemOop()`/`lastItemOop()` read
  collection endpoints without predicate scans,
  `add()`/`addAll()` and raw `addOop()`/`addAllOop()` append values,
  `includes()`/`contains()` and raw `includesOop()`/`containsOop()` check
  collection membership,
  `remove()`/`delete()` and raw `removeOop()`/`deleteOop()` remove members,
  `removeAll()`/`removeAllOop()` remove batches, and
  `replaceAll()`/`replaceAllOop()` plus `clear()` manage whole collections,
  `first()`/`firstOop()` return nullable first matches without materializing
  result arrays, `find()`/`findOop()`/`findValue()` alias the first-match
  helpers, `limit()`/`take()` fetch bounded predicate matches,
  `size()`/`isEmpty()` expose collection metadata, `count()` increments a
  counter without materializing selected matches, `exists()` and
  `any()`/`anyMatch()`/`none()` early-exit with `detect:ifNone:`, and
  `GSCollection.iter()` fetches collection chunks while yielding individual
  objects. Query comparison operators are validated before Smalltalk source is
  emitted. Equality-index helpers are available through both explicit
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
string, float, nested array marshalling/value/raw/page readback, dictionary readback, global
lookup/enumeration/nullable object/bulk required/raw set/removal helpers,
`GsDict` metadata, value/raw enumeration, replace/clear, nullable
object/dictionary pick, bulk required-read, and bulk removal helpers, and
`PersistentRoot` value, dictionary, key, size, pick, required-value, batch-value, bulk
nullable object/dictionary pick, required-read, and bulk removal helpers, plus
`GStore` JSON transaction round-trips. It
also covers live query add/remove, `count()`, `exists()`, `first()`, `limit()`,
and index create/remove when the backing collection supports GemStone index
selectors.

The inspection helpers are also available from the command line. The command
uses the same `GS_*` connection environment as `Session.configFromEnv()`:

```sh
npm run inspect -- --oop 123456789
npm run inspect -- --oop 123456789 --dump --depth 2
npm run inspect -- --class Booking --json
```

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

The current comparison with `gemstone-py` is tracked in
`docs/gemstone-py-parity.md`.

Node uses `@gemstone-js/native`, which is scaffolded in `../gemstone-js-native`
and is intended to expose napi-rs bindings over the shared `gemstone-gci` Rust
crate.

Deno and Bun adapters declare the GCI symbols directly with their built-in FFI
systems. Pointer-array and out-parameter calls are wired through typed arrays;
`GciErr` is decoded into the same `GciErrorInfo` shape used by the Node adapter.
Live-runtime hardening is still needed around platform coverage.
