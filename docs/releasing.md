# Releasing gemstone-js

`gemstone-js` should be released from a clean tag after the CI workflow passes
on `main`.

## Package Artifact

CI runs:

```sh
npm install --omit=optional
npm run typecheck
npm test
npm run pack:check
npm pack --json
```

The workflow uploads the npm tarball as a GitHub Actions artifact so the exact
package contents can be inspected before publishing.

## Publish Checklist

1. Verify `package.json` has the expected version, repository, license, and
   `publishConfig.provenance`.
2. Run `npm run pack:check` locally.
3. Review the CI tarball artifact contents.
4. Publish with provenance:

```sh
npm publish --access public --provenance
```
