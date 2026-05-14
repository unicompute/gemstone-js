# Benchmark Baselines

`gemstone-js` includes local benchmark artifact tooling for CI workflows. It
does not run live benchmarks yet; it validates and compares saved JSON reports.

Benchmark reports use the same compact shape as gemstone-py artifacts:

```json
{
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
      "operation": "execute",
      "ops_per_second": 1200,
      "count": 20
    }
  ]
}
```

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
