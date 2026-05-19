# Changelog

## 0.1.0 - 2026-05-19

- Added the initial VS Code wrapper around the gemstone-js Explorer.
- Added Explorer lifecycle commands, embedded webview support, and external browser opening.
- Added GemStone Doctor, Evaluate Selection, Debug Selection, and Run File commands.
- Added Evaluate Selection As for one-off inspect/value/OOP return-kind selection.
- Added Run File As and Set Default Return Kind return-kind controls.
- Added a thin `gemstone-js` debug adapter over the Explorer debugger API.
- Added Connection, Roots, Globals, and Classes tree views.
- Added class browser deep links from class tree entries.
- Added object inspector deep links from VS Code commands and tree entries.
- Added redacted connection summary copying.
- Added redacted Doctor report copying.
- Added object-name copy support from root/global tree entries.
- Added class-name copy support from the Classes tree and command palette.
- Improved Open Class Browser so it can use a selected class name or prompt from the command palette.
- Improved Inspect OOP and Copy OOP so they can use a selected decimal OOP before prompting.
- Added direct commands for Explorer workspace, globals, roots, symbol list, codegen, and status log windows.
- Added connection tree actions for browser opening, URL copy, and connection configuration.
- Added Run File to editor title/context menus and the connection tree.
- Added Debug File to editor title/context menus and the connection tree.
- Added Stop Explorer to the Connection tree.
- Added an Open Output command and connection tree action for the GemStone JS output channel.
- Exposed Open Settings in the command palette and VSIX manifest.
- Added tree context menu actions for inspecting and copying OOPs.
- Added per-tree refresh and filter commands.
- Added a shared Clear Tree Filters command.
- Added SecretStorage-backed password management.
- Added status bar connection state.
- Added VSIX packaging, checksum, Marketplace publish, and offline smoke verification.
