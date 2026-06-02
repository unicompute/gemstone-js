# Generated Documentation PDFs

Generated with:

```sh
npm run docs:screenshots
npm run docs:pdf
```

`npm run docs:screenshots` starts the actual `examples/explorer.ts` server and
captures the real Explorer UI in Chromium. When `GS_USERNAME`/`GS_PASSWORD` or
`GS_USER`/`GS_PASS` are configured, it also starts `examples/library-books.ts`
and captures the live Library Books catalog and borrowed-state screens. It does
not render synthetic HTML mockups. Set `GS_RUN_LIVE=1` when a live Stone is
available and you want the Explorer screenshots to include live
evaluation/class/debugger results.

The Medium article source is:

- `docs/articles/medium-gemstone-js-workbench.md`

The object-mapping guide is:

- `docs/object-mapping.md`

The article screenshots are:

- `docs/articles/assets/gemstone-js-explorer-workspace.png`
- `docs/articles/assets/gemstone-js-class-browser.png`
- `docs/articles/assets/gemstone-js-debugger.png`
- `docs/articles/assets/gemstone-js-library-books-catalog.png`
- `docs/articles/assets/gemstone-js-library-books-borrowed.png`
