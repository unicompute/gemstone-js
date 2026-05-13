# Releasing gemstone-js

`gemstone-js` should be released from a clean tag after the CI workflow passes
on `main`.

## Package Artifact

CI runs:

```sh
npm install --omit=optional
npm run verify
npm pack --json
node scripts/write-checksums.mjs .tgz
```

The workflow uploads the npm tarball as a GitHub Actions artifact so the exact
package contents can be inspected before publishing. CI also uploads
`SHA256SUMS.txt` for the generated tarball.

## Artifact Inspection

Before `npm publish`, compare the CI tarball with a local package:

```sh
npm pack --json
node scripts/write-checksums.mjs .tgz
tar -tzf gemstone-js-*.tgz
shasum -a 256 -c SHA256SUMS.txt
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
3. Review the CI tarball artifact contents and checksum file with the artifact
   inspection checklist above.
4. Publish with provenance:

```sh
npm publish --access public --provenance
```
