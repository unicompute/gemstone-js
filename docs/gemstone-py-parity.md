# gemstone-py Parity Notes

`gemstone-js` intentionally mirrors the practical parts of `gemstone-py` while
keeping a JavaScript-first async API.

## Aligned Surface

- Environment-based session configuration and explicit login/logout lifecycle.
- Raw execute/eval, value marshalling, typed object handles, and managed
  export-set handles.
- Class-side sends through an explicit class reference object.
- Persistent roots for `UserGlobals`, `Globals`, `Published`, and
  `SessionMethods`.
- `StringKeyValueDictionary` helpers with key, item, value, pick, require,
  replace, clear, nested dictionary, raw OOP, and object-handle variants.
- Collection helpers for search, first/find, count/exists, bounded pages,
  iteration, mutation, and equality indexes.
- Object inspection, bounded recursive object dumps, direct print-string
  helpers, and class descriptions.
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

- Higher-level persistent stores such as `GStore`.
- Reduced-conflict wrappers for `RcCounter`, `RcKeyValueDictionary`, and
  `RcQueue`.
- Migration helpers, object-log parsing, bootstrap commands, and benchmark
  baseline tooling.
- Inspection CLI wrappers around the object and class debug helpers.
- The `gemstone-py` VS Code workbench. A JavaScript extension should wait until
  the package API and native release flow settle further.
