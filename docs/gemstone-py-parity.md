# gemstone-py Parity Notes

`gemstone-js` intentionally mirrors the practical parts of `gemstone-py` while
keeping a JavaScript-first async API.

## Current Comparison

`gemstone-js` is now close to `gemstone-py` for core database work: sessions,
raw OOP handling, persistent roots, dictionaries, ordered collections, query
helpers, migrations, bootstrap, ObjectLog, inspection, code generation,
benchmarks, package verification, and optional native GCI access are all
represented.

`gemstone-py` is still the more mature application stack. It has the broader
example set, synchronous and asynchronous Python APIs, Flask/Django/FastAPI/
Litestar integrations, and a VS Code workbench. `gemstone-js` is stronger where
TypeScript matters: typed generated wrappers, JSON Schemas for
manifests/artifacts, explicit async handles, Node/Deno/Bun runtime boundaries,
npm provenance checks, and the native session-thread spike.

## Aligned Surface

- Environment-based session configuration and explicit login/logout lifecycle.
- Session pools with warmup, wait accounting, reset-aware release, validation
  queries, custom health checks, idle-timeout eviction, and max-age/max-use
  recycling, plus provider-style snapshots, lifecycle events, metrics, and
  spans.
- Raw execute/eval, value marshalling, typed object handles, and managed
  export-set handles.
- Class-side sends through an explicit class reference object.
- Persistent roots for `UserGlobals`, `Globals`, `Published`, and
  `SessionMethods`.
- `GStore`-style named JSON key/value stores under `UserGlobals.GStoreRoot`.
- GemStone-side bootstrap audit/source/command helpers for the persistence
  roots used by the libraries.
- Module-style migrations with dependency planning, status/current reads,
  upgrade/downgrade execution, checksum validation, advisory locks, recorded
  dry-runs, and a command-line runner.
- Transaction retry, nested transaction, and commit-conflict diagnostic helpers,
  adapted to JavaScript's async callback style.
- Benchmark report generation for offline `gci` and opt-in live persistence
  suites, plus baseline comparison, metadata-based baseline selection, baseline
  manifest registration/replacement, pruning, threshold enforcement, and
  command-line wrappers for saved report artifacts.
- `StringKeyValueDictionary` helpers with key, item, value, pick, require,
  replace, clear, nested dictionary, raw OOP, and object-handle variants.
- `OrderedCollection` wrappers for persistent ordered sequences, with explicit
  async value/raw/object accessors in JavaScript instead of Python magic
  methods.
- Reduced-conflict wrappers for `RcCounter`, `RcKeyValueDictionary`, and
  `RcQueue`, including the gemstone-py-style `RCCounter`, `RCHash`, and
  `RCQueue` aliases plus session factory helpers.
- Collection helpers for search, first/find, count/exists, bounded pages,
  iteration, mutation, and equality indexes.
- Object inspection, bounded recursive object dumps, direct print-string
  helpers, class descriptions, and the `gemstone-js-inspect` command.
- ObjectLog entry writes, batched fetch parsing, level filters, size, clear, and
  delete helpers.
- Observability hooks, framework adapters, code generation, package verification,
  and opt-in live smoke coverage.

## JavaScript-Specific Choices

- `Session` is async-first because Node must eventually move GCI work onto a
  dedicated native session thread.
- Unknown object results stay explicit as raw `Oop` values or retained
  `TypedOop<T>` handles; JavaScript does not use gemstone-py's dynamic
  attribute dispatch proxy.
- GemStone OOPs are represented as branded `bigint` values in TypeScript, while
  the native Node boundary uses decimal strings to avoid 64-bit precision loss.
- Root helper names use camelCase (`sessionMethods`) rather than Python's
  `session_methods`.

## Still Python-Only

- The `gemstone-py` VS Code workbench. A JavaScript extension should wait until
  the package API and native release flow settle further.
