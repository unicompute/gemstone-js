# Doctor

`gemstone-js-doctor` is a local setup check for GemStone connection
configuration and the optional native backend.

By default it does not connect to GemStone. It checks:

- the JavaScript runtime
- `GS_USERNAME` and `GS_PASSWORD`
- `GS_LIB_PATH`, `GS_LIB`, or `GEMSTONE` library discovery
- whether `@gemstone-js/native` can be imported

```sh
gemstone-js-doctor
gemstone-js-doctor --json
gemstone-js-doctor --no-native
```

Use `--live` when you want it to log in and evaluate `1 + 1`:

```sh
gemstone-js-doctor --live
gemstone-js-doctor --live --json
```

The JSON output masks secrets. It reports whether credentials are set, but it
does not print passwords or host passwords.
