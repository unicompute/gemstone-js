# Architecture

The first implementation slice follows `../plan.js.txt`:

- `src/runtime/index.ts` detects Node, Deno, or Bun and returns a fresh
  `GciRuntime` wrapper for each default `Session.connect()` call.
- `src/runtime/node.ts` calls `@gemstone-js/native`, the napi-rs addon in
  `../gemstone-js-native`. The native module import is cached, but the Node GCI
  wrapper is per session.
- `src/runtime/deno.ts` and `src/runtime/bun.ts` define the same low-level GCI
  surface through native FFI. Pointer-array and out-parameter calls use typed
  arrays so `perform()`, `fetchBytes()`, float conversion, and dictionary
  lookups share the same runtime contract as the Node adapter. Shared buffer
  helpers live in `src/runtime/ffi-buffers.ts`.
- `src/runtime/library-discovery.ts` mirrors the Rust/Python loader order:
  explicit path, `GS_LIB_PATH`, scan `GS_LIB`, then scan `GEMSTONE/lib`.
- `src/client.ts` owns the public async `Session` API. This lets the native
  implementation move blocking GCI calls to a dedicated session thread later
  without changing user code.
- `Session.marshalOop()` mirrors the Python binding's marshalling order:
  immediate values, float conversion, string/symbol class detection, then raw
  OOP fallback.
- `Session.argumentToOop()` handles the common JS-to-GemStone path. Use
  `perform()` for raw OOP arguments; use `performWith()` when you want JS values
  converted into GemStone objects.
- `Session.classRef()` is the first explicit object-model layer: it caches class
  symbol resolution and exposes async class-side sends, object-returning sends,
  and allocation while keeping remote calls visible.
- `GsDict` and `PersistentRoot` are convenience layers over the same session
  primitives. They should stay thin: the session owns marshalling and GCI calls.
- Query helpers render simple selector paths and unwrap GemStone arrays through
  `size`/`at:` so iterators yield object handles instead of chunk containers.
- Codegen helpers validate generated JavaScript identifiers and emit wrappers
  that choose between `performValueWith()`, `performWith()`, or
  `classRef().sendObject()` based on the requested return kind. Selector shape,
  arity, manifest structure, and module export uniqueness are checked before
  source is emitted so manifest mistakes fail locally.
- Generated modules can include type-only/value imports plus typed session,
  argument, and return annotations. The JSON Schema in `schemas/` gives editor
  feedback for hand-written manifests.
- The `codegen` npm script is a manifest-driven file generator around the same
  renderer, with a `--check` mode for keeping generated wrapper source explicit,
  reviewable, and current in CI.
- The `codegen:scan` script is a small source scanner for decorated classes. It
  emits reviewable manifests rather than hiding generated output in a build
  plugin.
- `Session.inspect()` asks GemStone for a compact string payload and parses it
  locally, avoiding a dependency on dictionary marshalling for debug metadata.
- Framework adapters treat failed commit/abort cleanup as a broken session and
  discard the lease instead of returning it to the pool.
- `SessionPool.warm()` targets total pool capacity and `stats()` includes
  pending acquires so saturated pools can be observed.
- `InMemoryMetrics` and `InMemoryTracer` provide dependency-free observability
  recorders for tests while the OpenTelemetry adapter maps to real spans.
- `src/runtime/serialized.ts` serializes all session-bound calls and reactivates
  the session id before dispatching into GCI. This is the current safety layer
  before a dedicated native session thread lands.
- `src/testing/mock-runtime.ts` lets the high-level API be tested without a live
  GemStone instance.

The runtime contract deliberately mirrors the function list in
`gemstone-py/gemstone_py/_gci_ctypes.py` and
`gemstone-rs/crates/gemstone-gci/src/lib.rs`.
