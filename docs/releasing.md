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
node scripts/verify-checksums.mjs SHA256SUMS.txt
```

The workflow uploads the npm tarball as a GitHub Actions artifact so the exact
package contents can be inspected before publishing. CI also uploads
`SHA256SUMS.txt` for the generated tarball after verifying it. The
`npm run verify` step includes `npm run examples:check` and
`npm run public-surface:check` so packaged examples, the example catalog, and
export-barrel changes are checked before packaging, and `npm run api-contract`
so the runtime package entrypoint, package metadata, schema exports, and CLI bin
targets are compared with the committed API contract.

## Artifact Inspection

Before `npm publish`, compare the CI tarball with a local package:

```sh
npm pack --json
node scripts/write-checksums.mjs .tgz
node scripts/verify-checksums.mjs SHA256SUMS.txt
tar -tzf gemstone-js-*.tgz
shasum -a 256 -c SHA256SUMS.txt
npm run api-contract:installed
```

Check that the tarball contains `src/`, `docs/`, `schemas/`, `examples/`, the
codegen scripts, API contract scripts, `README.md`, `LICENSE`, and
`package.json`. It must not
contain `tests/`, `tsconfig*.json`, optional native binaries, local caches, or
editor files. Verify that both checked-in generated files are present:
`examples/codegen.generated.ts` and
`examples/booking.decorators.generated.ts`, that the web adapter examples are
present, and that the public API contract file
`scripts/public-surface.expected.json` is present. The extracted-artifact
check also verifies that published CLI bin targets exist and keep their Node
shebangs, and that the installed example catalog includes the web and quickstart
examples.

## Publish Checklist

1. Verify `package.json` has the expected version, repository, license, and
   `publishConfig.provenance`.
2. Run `npm run verify` locally.
3. Run `npm run public-surface:check` if the public barrel changed, and review
   any intentional export changes before regenerating the contract with
   `npm run public-surface:write`.
4. Run `gemstone-js-api-contract --json` against the packed or installed
   package if the package entrypoint changed.
5. Review the CI tarball artifact contents and checksum file with the artifact
   inspection checklist above.
6. Publish with provenance:

```sh
npm publish --access public --provenance
```
