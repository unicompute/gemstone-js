# GemStone Name Validation

`gemstone-js` renders some helper calls as Smalltalk source. Names that are
embedded into that source use one shared validation policy: they must be simple
GemStone global-style identifiers.

Allowed names match:

```text
[A-Za-z_][A-Za-z0-9_]*
```

This policy applies to:

- `GSCollection` collection names.
- `PersistentRoot` root names.
- `PersistentRoot` entry names.
- `Session.global*()` global names.

Examples of accepted names include `UserGlobals`, `Bookings`, `_Scratch`, and
`Booking2026`. Empty strings, names with spaces, qualified paths, punctuation,
and embedded Smalltalk source are rejected before any GCI call is made.

Dictionary string keys are different: `GsDict` and `StringKeyValueDictionary`
helpers pass keys through GCI string-key APIs, so they may use ordinary string
keys instead of this global-name policy.
