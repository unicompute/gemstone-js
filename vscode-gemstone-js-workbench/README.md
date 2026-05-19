# gemstone-js Workbench

VS Code wrapper for the gemstone-js Explorer. The extension starts the local Explorer server, embeds it in a webview, exposes connection/object trees, and provides basic GemStone code evaluation and debugging commands.

## Commands

- `GemStone: Open Explorer` starts the JS Explorer server and opens it in a VS Code webview.
- `GemStone: Open Explorer in Browser` opens the Explorer URL in the system browser.
- `GemStone: Start Explorer Server` starts the Explorer without opening a UI.
- `GemStone: Stop Explorer Server` stops the managed Explorer process.
- `GemStone: Restart Explorer Server` restarts the managed Explorer process.
- `GemStone: Doctor` runs connection/config diagnostics and writes JSON to the GemStone JS output channel.
- `GemStone: Evaluate Selection` sends the current selection to the Explorer session. If evaluation raises, the debugger opens automatically.
- `GemStone: Debug Selection` starts a VS Code debug session for the current selection.
- `GemStone: Run File` evaluates the current editor contents.

## Views

The GemStone activity bar contributes:

- Connection status
- Roots
- Globals
- Classes

Roots, globals, and classes load from the Explorer API. OOP-backed items can be inspected from the tree.

## Settings

Configure `gemstoneJs.*` in VS Code settings:

- `gemstoneJs.repoPath`
- `gemstoneJs.nodePath`
- `gemstoneJs.explorerScriptPath`
- `gemstoneJs.explorerHost`
- `gemstoneJs.explorerPort`
- `gemstoneJs.openMode`
- `gemstoneJs.user`
- `gemstoneJs.password`
- `gemstoneJs.stone`
- `gemstoneJs.netldiHost`
- `gemstoneJs.netldiNameOrPort`
- `gemstoneJs.gemService`
- `gemstoneJs.nativeSessionWorker`
- `gemstoneJs.extraEnv`
- `gemstoneJs.defaultReturnKind`

The extension maps these settings to the Explorer environment, including `GS_USER`, `GS_PASS`, `GS_STONE`, `GS_NETLDI_HOST`, `GS_NETLDI_NAME_OR_PORT`, and `GS_NATIVE_SESSION_WORKER`.

## Debugger

The `gemstone-js` debug type wraps the Explorer debugger API. It supports:

- Stack display
- Source previews from GemStone context frames
- Local/receiver/exception variables
- Continue
- Step over
- Step in
- Step out
- Restart

The debugger is intentionally thin in this first version; session semantics remain owned by the Explorer server.

## Development

From this directory:

```sh
npm run verify
```

This checks the extension entrypoint, packages a versioned VSIX, and verifies the
archive contents.

To package a fixed local smoke-test artifact:

```sh
npm run package:dry-run
```

The GitHub `VS Code Workbench` workflow builds and uploads the VSIX on changes
under this directory. Run it manually with `publish-to-marketplace=true` to
publish the package with the repository `VSCE_PAT` secret.
