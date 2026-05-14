# Benchmarks

`gemstone-js` includes a small maintained benchmark lane plus local benchmark
artifact tooling for CI workflows. The `gci` suite is offline and needs no
GemStone credentials. The persistence suites connect to a configured Stone and
should be run intentionally against a disposable or benchmark image.

Benchmark reports use the same compact shape as gemstone-py artifacts:

```json
{
  "$schema": "./schemas/benchmark-report.schema.json",
  "schema_version": 1,
  "stone": "gs64stone",
  "platform": "darwin-arm64",
  "runtime": "node",
  "node_version": "24.0.0",
  "gci_backend": "native",
  "entries": 500,
  "search_runs": 20,
  "suites": ["gci"],
  "results": [
    {
      "suite": "gci",
      "operation": "smallint_roundtrip",
      "elapsed_seconds": 0.016,
      "ops_per_second": 1200,
      "count": 20
    }
  ]
}
```

The package ships JSON Schemas for editor and CI validation:

- `schemas/benchmark-report.schema.json`
- `schemas/benchmark-baseline-manifest.schema.json`

Generate reports with `gemstone-js-benchmarks`:

```sh
npm run benchmarks -- --suite gci --entries 100000 --json --output benchmark-report.json
npm run benchmarks -- --suite persistent_root --suite gstore --entries 500 --json --output live-report.json
```

The default suite list is `gci`, `persistent_root`, `gscollection`, `gstore`,
and `rchash`. Select only `gci` for a no-credential local check. Select any of
the persistence suites only when `GS_*` connection environment variables point
at a Stone prepared for benchmark data.

Compare a candidate report with a committed baseline:

```sh
npm run benchmark:compare -- baseline.json candidate.json
npm run benchmark:compare -- baseline.json candidate.json --max-regression-pct 10
npm run benchmark:compare -- baseline.json candidate.json --json --output benchmark-compare.json
```

Select a committed baseline whose metadata matches a candidate:

```sh
npm run benchmark:baselines -- benchmark-report.json --manifest .github/benchmarks/index.json
```

Register or maintain committed baseline artifacts:

```sh
npm run benchmark:register -- benchmark-report.json --manifest .github/benchmarks/index.json
npm run benchmark:register -- benchmark-report.json --copy-to baseline-macos-arm64.json
npm run benchmark:register -- --manifest .github/benchmarks/index.json --prune-missing
```

The comparison command supports global, suite-level, and operation-level
regression thresholds. Operation thresholds take precedence over suite
thresholds, and suite thresholds take precedence over the global threshold.
