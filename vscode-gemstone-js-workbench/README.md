# gemstone-js Workbench

VS Code wrapper for the gemstone-js Explorer. The extension starts the local Explorer server, embeds it in a webview, exposes connection/object trees, and provides basic GemStone code evaluation and debugging commands.

## Commands

- `GemStone: Open Explorer` starts the JS Explorer server and opens it in a VS Code webview.
- `GemStone: Open Explorer in Browser` opens the Explorer URL in the system browser.
- `GemStone: Open Class Browser` opens the Explorer Class Browser focused on a class.
- `GemStone: Start Explorer Server` starts the Explorer without opening a UI.
- `GemStone: Stop Explorer Server` stops the managed Explorer process.
- `GemStone: Restart Explorer Server` restarts the managed Explorer process.
- `GemStone: Filter Roots`, `GemStone: Filter Globals`, and `GemStone: Filter Classes` narrow tree contents.
- `GemStone: Doctor` runs connection/config diagnostics and writes JSON to the GemStone JS output channel.
- `GemStone: Evaluate Selection` sends the current selection to the Explorer session. If evaluation raises, the debugger opens automatically.
- `GemStone: Debug Selection` starts a VS Code debug session for the current selection.
- `GemStone: Run File` evaluates the current editor contents.
- `GemStone: Set Password` stores the GemStone password in VS Code SecretStorage.
- `GemStone: Clear Password` removes the SecretStorage password.

## Views

The GemStone activity bar contributes:

- Connection status
- Roots
- Globals
- Classes

Roots, globals, and classes load from the Explorer API. OOP-backed items can be inspected from the tree.
Class rows open the Explorer Class Browser focused on that class. Root/global/class views have their own refresh and filter actions.

## Language Support

The extension contributes the `smalltalk` language id for `.st`, `.gs`, and
`.topaz` files, with lightweight GemStone Smalltalk syntax highlighting and
editor pairs for strings, comments, blocks, arrays, and braces.

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

The extension maps these settings to the Explorer environment, including `GS_USER`, `GS_PASS`, `GS_STONE`, `GS_NETLDI_HOST`, `GS_NETLDI_NAME_OR_PORT`, and `GS_NATIVE_SESSION_WORKER`. Prefer `GemStone: Set Password` over the legacy `gemstoneJs.password` setting so the password is stored in VS Code SecretStorage instead of plain settings JSON.

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

The extension contributes launch configuration snippets for debugging the current selection or an inline Smalltalk expression. Evaluate and Debug commands are also available from the editor title area and editor context menu.

The debugger is intentionally thin in this first version; session semantics remain owned by the Explorer server.

## Development

From this directory:

```sh
npm run verify
```

This checks the extension entrypoint, packages a versioned VSIX, and verifies the
archive contents. It also runs an offline smoke test that activates the extension
against a lightweight VS Code API mock. VSIX verification checks required files,
the packaged extension manifest, command/view/debugger contributions, and
optional checksum artifacts.

To run the real VS Code extension-host smoke test:

```sh
GS_RUN_VSCODE_HOST=1 npm run test:host
```

That test starts VS Code through `@vscode/test-electron`, activates the extension,
opens the Explorer against a fake local Explorer server, and starts/stops a
`gemstone-js` debug session without requiring a live Stone.

To package a fixed local smoke-test artifact:

```sh
npm run package:dry-run
```

To produce the release artifact and checksum used by CI:

```sh
npm run release:package
```

Before bumping the VSIX version, add the matching entry to `CHANGELOG.md`.
Then run:

```sh
npm run release -- 0.1.1
```

To publish from a prepared checkout with a Marketplace token:

```sh
VSCE_PAT=... npm run release:publish -- 0.1.1
```

The GitHub `VS Code Workbench` workflow builds and uploads the VSIX on changes
under this directory. Run it manually with `publish-to-marketplace=true` to
publish the package with the repository `VSCE_PAT` secret.
