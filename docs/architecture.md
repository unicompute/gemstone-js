# Architecture

The first implementation slice follows `../plan.js.txt`:

- `src/runtime/index.ts` detects Node, Deno, or Bun and returns a fresh
  `GciRuntime` wrapper for each default `Session.connect()` call.
- `src/runtime/node.ts` calls `@gemstone-js/native`, the napi-rs addon in
  `../gemstone-js-native`. The native module import is cached, but the Node GCI
  wrapper is per session.
- `src/runtime/deno.ts` and `src/runtime/bun.ts` define the same low-level GCI
  surface through native FFI. Pointer-array and out-parameter calls use typed
  arrays so `perform()`, `fetchBytes()`, float conversion, `GciErr`, and
  dictionary lookups share the same runtime contract as the Node adapter. Shared
  buffer helpers live in `src/runtime/ffi-buffers.ts`.
- `src/runtime/library-discovery.ts` mirrors the Rust/Python loader order:
  explicit path, `GS_LIB_PATH`, scan `GS_LIB`, then scan `GEMSTONE/lib`.
- `src/client.ts` owns the public async `Session` API. This lets the native
  implementation move blocking GCI calls to a dedicated session thread later
  without changing user code.
- `Session.executeObject()`/`evalObject()` and
  `executeManaged()`/`evalManaged()` mirror gemstone-py's typed/managed execute
  helpers while keeping raw `execute()` and value-marshalling `eval()` explicit.
- `Session.marshalOop()` mirrors the Python binding's marshalling order:
  immediate values, float conversion, string/symbol class detection, then raw
  OOP fallback.
- `Session.arrayOopToValues()` recursively reads GemStone `Array` instances
  through `size` and `at:` with cycle detection plus optional per-array,
  total-item, and depth limits for callers that need bounded readback.
- `Session.arrayOopToOops()` and `arrayObjects()` read raw and retained object
  handles from GemStone `Array` instances through the same `size`/`at:` path,
  with a `maxItems` bound for callers that need handles instead of values.
  `arrayOopToObjects()` is the direct retained-handle counterpart for callers
  that already have a raw Array OOP.
- `Session.arraySize()`, `arrayAt*()`, nullable `arrayFirst*()`/`arrayLast*()`,
  bounded `arrayPage*()`/`arrayTake*()`, batch `arrayPick*()`/`arraySetAll*()`,
  and single-index `arraySet*()` expose direct one-based GemStone `Array`
  metadata and indexed element access without materializing whole arrays.
- `Session.dictionaryOopToObject()` and `dictionaryValues()` read GemStone
  `StringKeyValueDictionary` instances through the `GsDict` key-enumeration
  path, preserving the existing string-key and value-marshalling behavior.
  Session-level dictionary key/item/value-list, get/set/replace/remove,
  pick/require, and size helpers delegate to the same wrapper path for callers
  that have a raw dictionary OOP but do not need to keep a `GsDict` wrapper
  around.
- `Session.argumentToOop()` handles the common JS-to-GemStone path. Use
  `perform()` for raw OOP arguments; use `performWith()` when you want JS values
  converted into GemStone objects.
- `Session.classRef()` is the first explicit object-model layer: it caches class
  symbol resolution and exposes async class-side sends, object-returning sends,
  and allocation while keeping remote calls visible. Class names use the shared
  simple GemStone global-name validation policy because classes live in globals.
- `GsDict` and `PersistentRoot` are convenience layers over the same session
  primitives. They should stay thin: the session owns marshalling and GCI calls,
  while wrappers expose explicit value/raw/object accessors, value-named setter
  aliases, object-named setter aliases for stored OOP handles, nested
  dictionary helpers including batch dictionary setters, send helpers,
  dictionary metadata, dictionary/root enumeration, replace/clear lifecycle
  helpers for owned string-key dictionaries, global/root size helpers, and
  required global/root accessors. `PersistentRoot.userGlobals()`,
  `globals()`, `published()`, and `sessionMethods()` mirror the named
  SymbolDictionary constructors in gemstone-py.
- `GStore` builds on `PersistentRoot` and `GsDict` rather than adding another
  storage layer. Each named store is a `StringKeyValueDictionary` under
  `UserGlobals.GStoreRoot`; values are JSON strings, transaction callbacks use
  an in-memory snapshot plus dirty/delete buffers, and the caller's session owns
  transaction visibility.
- Migration helpers are intentionally library-first. Version metadata and
  advisory locks are JSON strings in `UserGlobals`, so the runner can use the
  existing root marshalling path and stay reviewable. The public API validates
  dependency order, unknown applied ids, and checksum drift before applying
  steps; each step commits after its metadata write.
- Benchmark helpers are split between report generation and saved-artifact
  policy. `src/benchmarks.ts` can generate compact reports from the offline
  `gci` suite or opt-in live persistence suites, while
  `src/benchmark-baselines.ts` validates saved report JSON, compares result
  rows with regression thresholds, selects metadata-compatible baselines from a
  manifest, can compare a candidate directly against the selected manifest
  baseline, rejects ambiguous duplicate baseline metadata by default, can
  intentionally replace matching manifest entries during registration, and
  updates baseline manifests for CI enforcement.
- `RcCounter`, `RcKeyValueDictionary`, and `RcQueue` are thin wrappers over the
  GemStone reduced-conflict classes used by gemstone-py. They keep creation,
  session factory helpers, sends, enumeration, and raw-OOP variants explicit so
  callers can choose value marshalling or handle-level APIs without hiding
  transaction behavior.
- `bootstrapGemStone()` and `gemstone-js-bootstrap` mirror the useful
  GemStone-side bootstrap flow from `gemstone-py`: audit known helper roots,
  create missing roots idempotently, and write a JavaScript-specific bootstrap
  version marker while leaving application data intact.
- Source-rendered helper names and class-ref names share one validation policy.
  Collection names, class names, persistent-root names, persistent-root entries,
  and direct global names must be simple GemStone global-style identifiers;
  dictionary string keys are passed through string-key GCI APIs and are not
  constrained by that policy. See `docs/naming.md`.
- `ObjectLog` is a session-bound wrapper over GemStone `ObjectLogEntry`.
  It reads batch ObjectLog rows into one escaped string payload and parses locally,
  matching the `gemstone-py` parser contract while keeping commits and aborts
  explicit through the caller's session.
- Query helpers render simple selector paths, expose collection metadata,
  can count/check predicate matches without materializing selected results, can
  read whole collections, bounded pages, indexed items, or collection endpoints
  as handles or marshalled values, can check, add, remove, replace, or clear
  collection members through explicit value and raw-OOP helpers, and delegate
  GemStone array unwrapping to the session readback helpers so iterators yield
  object handles instead of chunk containers. Selector paths and comparison
  operators are both validated before source is emitted, and alias helpers such
  as `find()`, `any()`, and `none()` use the same underlying bounded query
  forms as `first()` and `exists()`.
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
  emits reviewable manifests by default and can emit generated wrapper modules
  directly with `--module`; either mode can be checked against a committed file
  with `--check --out`.
- `Session.inspect()`, bounded recursive `dump()`, and `describeClass()` ask
  GemStone for compact string payloads and parse them locally, avoiding a
  dependency on dictionary marshalling for debug metadata.
  `Session.printString()`, `GemStoneClassRef.describe()`, and retained handle
  `inspect()`/`dump()`/`printString()` expose the same debug path from raw
  handles, class refs, and retained handles.
- Framework adapters treat failed commit/abort cleanup as a broken session and
  discard the lease instead of returning it to the pool.
- `SessionPool.warm()` targets total pool capacity and `stats()` includes
  pending acquires so saturated pools can be observed. `withSession()` gives
  applications a callback helper that always releases the lease and preserves
  callback errors if cleanup fails.
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
