# Releasing gemstone-js

`gemstone-js` should be released from a clean tag after the CI workflow passes
on `main`.

## Package Artifact

CI runs:

```sh
npm install --omit=optional
npm run typecheck
npm run codegen:check
npm run codegen:scan:check
npm test
npm run pack:check
npm pack --json
```

The workflow uploads the npm tarball as a GitHub Actions artifact so the exact
package contents can be inspected before publishing.

## Artifact Inspection

Before `npm publish`, compare the CI tarball with the local dry-run package:

```sh
npm pack --dry-run --json
tar -tzf gemstone-js-*.tgz
```

Check that the tarball contains `src/`, `docs/`, `schemas/`, `examples/`, the
codegen scripts, `README.md`, `LICENSE`, and `package.json`. It must not
contain `tests/`, `tsconfig*.json`, optional native binaries, local caches, or
editor files. Verify that both checked-in generated files are present:
`examples/codegen.generated.ts` and
`examples/booking.decorators.generated.ts`.

## Publish Checklist

1. Verify `package.json` has the expected version, repository, license, and
   `publishConfig.provenance`.
2. Run `npm run pack:check` locally.
3. Review the CI tarball artifact contents with the artifact inspection
   checklist above.
4. Publish with provenance:

```sh
npm publish --access public --provenance
```
