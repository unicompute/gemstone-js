# gemstone-js

`gemstone-js` is the TypeScript bridge to GemStone/S described in
`../plan.js.txt`.

This initial slice locks in the public async API, OOP encoding helpers, runtime
dispatch layer, test mock, session/pool scaffolding, and a separate
`@gemstone-js/native` napi-rs starter. The live GCI implementation is in the
native package; the TypeScript package can be tested locally with a mock runtime.

## Current Status

- Async-first API: `Session.connect()`, `execute()`, `perform()`,
  `withTransaction()`, and `AsyncDisposable` support.
- High-level argument marshalling through `performWith()` and
  `ManagedOop.send()`: strings become GemStone strings, numbers become
  SmallIntegers or Floats, bigints become SmallIntegers, booleans/null become
  immediate OOPs, plain objects become `StringKeyValueDictionary`, and managed
  handles pass their retained OOP.
- Runtime adapters: Node (`@gemstone-js/native`), Deno FFI starter, Bun FFI
  starter, and a mock runtime for tests.
- OOP helpers ported from `gemstone-rs/crates/gemstone-gci`.
- Low-level allocation/fetch helpers: `newOop()`, `fetchClass()`,
  `fetchSize()`, and `fetchBytes()`.
- Dictionary/global helpers: `dictionaryToOop()`, `strDictGet()`,
  `strDictSet()`, `globalGet()`, and `globalSet()`.
- `GsDict` wraps GemStone `StringKeyValueDictionary` objects with `get()`,
  `set()`, `has()`, and `pick()` helpers.
- `PersistentRoot` now has value helpers (`getValue()`, `setValue()`,
  `getDict()`, `setDict()`) built on the session marshalling layer.
- Session pool release is reset-aware: dirty sessions are aborted before reuse,
  failed resets are discarded, waiters are served with replacement sessions, and
  close rejects pending acquires.
- Result marshalling now converts GemStone `String` and `Symbol` objects back
  into JavaScript strings via `fetchString()` and class detection. Float OOPs are
  converted when the runtime reports that `GciOopToFlt_` succeeded.
- Pool, observability hooks, persistent-root, query, codegen, and framework
  adapter scaffolds.

## Local Smoke Test

```sh
npm test
```

Node 24 can execute the `.ts` tests directly using built-in type stripping.

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
systems. They are present so the public API and dispatch shape are fixed early;
the pointer-array details for calls such as `GciPerform` still need live-runtime
hardening.
