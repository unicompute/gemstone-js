#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const COMPARISON_REPORT_SCHEMA_VERSION = 1;
const COMPARISON_REPORT_SCHEMA_PATH = "./schemas/comparison-report.schema.json";

const PROJECTS = {
  "gemstone-js": {
    comparison: "gemstone-js",
    title: "gemstone-js vs gemstone-py",
    fullGuide: "docs/gemstone-js-vs-gemstone-py.md",
    answer: "gemstone-py remains the more mature Python application stack; gemstone-js is the TypeScript/Node path for async JS services, typed generated wrappers, npm packaging, and explicit OOP handles.",
    projectLabel: "gemstone-js",
    pyUseWhen: [
      "You are building Python applications, notebooks, scripts, or web services.",
      "You want the broadest current examples across FastAPI, Litestar, Django, async, docs, and packaging.",
      "You need the mature Python database explorer, VS Code workbench, and PyPI/TestPyPI release path today.",
    ],
    projectUseWhen: [
      "You are building Node, TypeScript, or JavaScript services that should keep GemStone access in the JS runtime.",
      "You want async-first APIs, npm packaging, and TypeScript-generated signatures.",
      "You are willing to work with a newer alpha surface while native package confidence matures.",
    ],
    pyStrengths: [
      "Mature Python package and optional native acceleration install path.",
      "Broader web framework examples and async workflow coverage.",
      "Richer database explorer, VS Code workbench, and public docs/release surfaces.",
    ],
    projectStrengths: [
      "Async-first API shape that fits Node services naturally.",
      "Manifest/decorator codegen with TypeScript type signatures and schema checks.",
      "npm-oriented doctor, examples, migrations, inspect, explorer, benchmarks, and package smoke tooling.",
    ],
    rows: [
      row("Best fit", "Python applications, scripts, notebooks, data tooling, FastAPI/Litestar/Django services, and Python-first teams", "TypeScript/JavaScript services, CLIs, Node-based tooling, web adapters, and teams already using npm workflows", "Choose gemstone-py for Python products; choose gemstone-js for async TypeScript applications that need direct GemStone access"),
      row("API style", "Sync and async Python APIs, explicit sessions, managed OOP handles, and Pythonic converters", "Async-first Session API, AsyncDisposable support, typed OOP helpers, managed handles, request scopes, pools, and converter registry", "gemstone-js is naturally stronger for async JavaScript services; gemstone-py is easier for Python scripting"),
      row("Web frameworks", "FastAPI, Litestar, and Django examples are first-class", "Express, Fastify, Fetch API, and Hono adapters delegate request teardown through a shared scope layer", "Both are credible for web services; pick the framework ecosystem your application already uses"),
      row("Codegen", "Python codegen and typed-access demos", "Manifest/decorator-driven TypeScript codegen with schemas, arity checks, typed signatures, and generated examples", "Use gemstone-js when TypeScript types and decorator scanning matter; gemstone-py remains the broader reference implementation"),
      row("Native/runtime layer", "Python native path is already integrated with release tooling", "Node native package, Deno/Bun FFI starters, mock runtime, and library discovery via GS_LIB_PATH/GS_LIB/GEMSTONE", "gemstone-js needs more live native-platform proof before it matches gemstone-py operational confidence"),
    ],
    gaps: [
      gap("P1", "Published native confidence", "gemstone-py has a working package/release lane and optional native acceleration path.", "gemstone-js is alpha and depends on optional @gemstone-js/native plus Deno/Bun FFI starter paths that need broader live proof.", "Publish and verify gemstone-js plus @gemstone-js/native across supported Node platforms, then run npm verify and live smoke tests from a clean install.", "cd /Users/tariq/src/gemstone-js && npm run verify && GS_RUN_LIVE=1 npm run test:live"),
      gap("P1", "Visual tooling", "gemstone-py has python-gemstone-database-explorer and a more mature VS Code workbench flow.", "gemstone-js has a small packaged browser explorer example plus inspect/doctor/examples CLIs, but not a full VS Code workbench yet.", "Productize the gemstone-js explorer/workbench layer and reuse the Rust/Python explorer concepts for TypeScript codegen and inspection workflows.", "node --experimental-strip-types examples/explorer.ts; npm run examples:check"),
      gap("P2", "Live coverage", "gemstone-py has broader live GemStone testing across sync, async, framework, lifetime, and native behavior.", "gemstone-js has a live test entry point, but more runtime/platform combinations and framework-adapter live flows are needed.", "Add scheduled/manual live CI for login, eval, performWith, pools, request scopes, migrations, query helpers, and all web adapters.", "GS_RUN_LIVE=1 npm run test:live"),
    ],
    batches: [
      batch(1, "Native publish confidence", 6, 10, "Publish and verify gemstone-js plus @gemstone-js/native from a clean install across supported Node platforms.", "cd /Users/tariq/src/gemstone-js && npm run verify && GS_RUN_LIVE=1 npm run test:live"),
      batch(2, "Visual tooling polish", 10, 18, "Productize explorer/workbench flows for inspect, browse, TypeScript codegen, and persistent roots.", "node --experimental-strip-types examples/explorer.ts; npm run examples:check"),
      batch(3, "Installed examples", 5, 8, "Add clean-install examples for quickstart, web adapters, migrations, codegen, and persistence helpers.", "npm run examples:check; gemstone-js-examples --json"),
      batch(4, "Live CI", 8, 14, "Cover Node, Deno, Bun, framework adapters, pools, transactions, migrations, and query helpers against a real stone.", "GS_RUN_LIVE=1 npm run test:live"),
      batch(5, "Documentation and release polish", 5, 8, "Add article-style docs, release checklist coverage, checksums, and npm post-publish verification.", "npm run pack:check; docs link check when available"),
      batch(6, "Cross-project alignment", 8, 14, "Align gemstone-js concepts with gemstone-py and gemstone-rs explorers, codegen, persistent roots, and live smoke workflows.", "gemstone-js comparison checklist plus clean-install smoke scripts"),
    ],
    betaAnswer: "gemstone-js is down to one conservative JavaScript beta validation batch: run the release candidate from clean installed artifacts across the supported native/live path.",
    betaBatches: [
      batch(1, "Release candidate validation", 4, 8, "Run the JS and native packages from clean installed artifacts, verify worker-mode live smoke, and inspect release metadata before publishing.", "npm run verify && npm run native-install:check && GS_RUN_LIVE=1 GS_NATIVE_SESSION_WORKER=1 npm run test:live"),
    ],
  },
  "gemstone-rs": {
    comparison: "gemstone-rs",
    title: "gemstone-rs vs gemstone-py",
    fullGuide: "docs/gemstone-rs-comparison.md",
    answer: "gemstone-py remains more mature for Python apps, web examples, explorer polish, and release lanes; gemstone-rs is the better fit for Rust-native services, CLIs, typed wrappers, and the future shared native core.",
    projectLabel: "gemstone-rs",
    pyUseWhen: [
      "You are building Python applications, notebooks, scripts, or web services.",
      "You want the broadest current examples across FastAPI, Litestar, Django, async, docs, and packaging.",
      "You need the mature Python database explorer and PyPI/TestPyPI release path today.",
    ],
    projectUseWhen: [
      "You are building Rust services, CLIs, workers, or local tooling that should talk to GemStone without Python.",
      "You want compile-time checked generated wrappers, typed return helpers, and explicit OOP/value handling.",
      "You want the Rust GCI core that can eventually be shared underneath gemstone-py-native.",
    ],
    pyStrengths: [
      "Mature Python package and optional native acceleration install path.",
      "Broader web framework examples and async workflow coverage.",
      "Richer database explorer and public docs/release surfaces.",
    ],
    projectStrengths: [
      "Direct Rust API over GemStone/S with no Python process required.",
      "Typed codegen, BridgeRoot object mapping, derive support, and compile-time wrapper checks.",
      "CLI, explorer, and VS Code workflows that exercise the Rust core directly.",
    ],
    rows: [
      row("Best fit", "Python apps, scripts, notebooks, FastAPI/Litestar/Django examples, and Python-first teams", "Rust services, CLIs, workers, native tooling, and no-Python GemStone access", "Choose the language/runtime your application already lives in"),
      row("Install path", "python -m pip install gemstone-py; optional native acceleration with gemstone-py[fast]", "cargo add gemstone-rs; cargo install gemstone-rs-cli gemstone-rs-explorer", "Use pip for Python deliverables and Cargo for Rust deliverables"),
      row("Examples", "gemstone-examples list, plan3-map, hello, quickstart, fastapi, litestar", "gemstone-rs hello; examples list/map/show/run/scaffold; Cargo examples from source checkout", "gemstone-py is ahead for breadth; gemstone-rs now has comparable discovery and standalone project scaffolds"),
      row("Web frameworks", "FastAPI, Litestar, and Django examples are first-class", "Shared gemstone_rs::web health helpers, standard-library HTTP, SessionWorkerPool, packaged Axum/Actix adapters, and checked Axum/Actix examples exist", "Use gemstone-py for the broadest framework coverage; use gemstone-rs when Rust services need direct health routes and bounded session-worker boundaries"),
      row("Codegen and mapping", "Python codegen and typed access demos", "Rust wrapper generation, typed argument conversion, typed return helpers, BridgeRoot mapping, derive macro, preview/diff/check/generate", "Use gemstone-rs when compile-time Rust wrapper checks matter"),
      row("Native bridge direction", "Python API should eventually consume a thin PyO3 native layer", "Owns the long-term shared GCI core in gemstone-gci and gemstone-rs", "Make gemstone-py-native wrap the Rust core over time"),
    ],
    gaps: [
      gap("P1", "Web framework adapters", "FastAPI, Litestar, and Django examples are first-class and documented.", "gemstone-rs has shared JSON health helpers, std HTTP, graceful health-pool startup, packaged Axum/Actix adapters, checked services, route smoke coverage, and installed scaffolds. It still needs richer framework middleware and request tracing.", "Add middleware examples, request tracing, and stricter live route smoke tests for the packaged Axum/Actix adapters.", "cargo run --manifest-path examples/actix-service/Cargo.toml -- --routes"),
      gap("P1", "Explorer product polish", "python-gemstone-database-explorer is the richer class browser and product reference.", "gemstone-rs-explorer has useful endpoints and a local UI, but less polished browsing, diff, and BridgeRoot flows.", "Make the embedded explorer webview the primary IDE surface for dictionaries, classes, methods, codegen, and BridgeRoot inspection.", "python3 scripts/explorer_endpoint_smoke.py; vscode-gemstone-rs-workbench smoke test"),
      gap("P1", "Installed example experience", "gemstone-examples launches installed examples without needing a source checkout.", "gemstone-rs scaffolds many standalone Cargo projects, but explorer-integrated workflows still need installed templates.", "Expand examples scaffold templates to explorer-integrated projects and richer generated wrapper profile variants.", "gemstone-rs examples scaffold profile_codegen_workflow /tmp/gemstone-rs-profile-codegen --force"),
      gap("P2", "Async facade", "gemstone-py has async examples, FastAPI integration, and lifetime/GC tests around async behavior.", "gemstone-rs keeps Session non-Send/non-Sync and has SessionWorkerPool plus packaged web adapters, but no general async facade yet.", "Add an async facade over SessionWorkerPool after GCI thread behavior is proven with live tests.", "GS_RUN_LIVE_RUST=1 cargo test -p gemstone-rs live_"),
      gap("P2", "Shared native core", "gemstone-py already exposes a Python package and optional native acceleration path.", "gemstone-py-native does not yet wrap gemstone-gci/gemstone-rs as the shared native implementation.", "Make gemstone-py-native a thin PyO3 adapter over the Rust GCI/session core.", "gemstone-py native backend checks plus gemstone-rs live smoke tests"),
      gap("P2", "Release lane depth", "gemstone-py has PyPI/TestPyPI, native wheel, VSIX, and post-publish verification lanes.", "gemstone-rs has crates/VSIX verification, but the full publish workflow is newer and less exercised.", "Run the full release workflow regularly and keep crates.io, Marketplace, GitHub Release assets, PDFs, and checksums verified.", "scripts/publish_verify.sh <version>; scripts/verify_release_artifacts.py"),
    ],
    batches: [
      batch(1, "Explorer and VS Code webview polish", 10, 18, "Make the embedded explorer the main IDE surface for browsing, codegen preview/diff, and BridgeRoot inspection.", "python3 scripts/explorer_endpoint_smoke.py; vscode-gemstone-rs-workbench smoke test"),
      batch(2, "Object mapping maturity", 8, 14, "Improve nested object/array/dictionary read-back, relationship examples, identity-cache behavior, and mapping diagnostics.", "cargo test -p gemstone-rs bridge_ mapping_"),
      batch(3, "Codegen live discovery and generated tests", 8, 14, "Discover richer GemStone class/method metadata, generate typed wrappers/tests, and improve explain/diff output for editors.", "cargo run -p gemstone-rs-cli -- codegen explain examples/codegen/gemstone-rs.codegen --json"),
      batch(4, "Async facade and web middleware", 6, 12, "Layer a cautious async facade over SessionWorkerPool and add Axum/Actix middleware, tracing, and route smoke coverage.", "cargo run --manifest-path examples/axum-service/Cargo.toml -- --routes"),
      batch(5, "Shared core with gemstone-py-native", 8, 14, "Make gemstone-py-native a thin PyO3 adapter over gemstone-gci/gemstone-rs so Python and Rust share the native bridge.", "gemstone-py native backend checks plus gemstone-rs live smoke tests"),
      batch(6, "Release and live CI hardening", 4, 7, "Exercise crates.io, Marketplace, GitHub Release assets, PDFs, checksums, and manual/scheduled live GemStone workflows.", "scripts/publish_verify.sh <version>; scripts/verify_release_artifacts.py"),
    ],
    betaAnswer: "gemstone-rs is about four focused hardening batches from a conservative Rust beta: explorer polish, mapping/codegen proof, web worker hardening, and release/live CI confidence.",
    betaBatches: [
      batch(1, "Explorer and workbench polish", 8, 14, "Make browsing, codegen preview/diff, and BridgeRoot inspection coherent enough for daily Rust use.", "python3 scripts/explorer_endpoint_smoke.py; vscode-gemstone-rs-workbench smoke test"),
      batch(2, "Mapping and codegen live proof", 8, 14, "Prove generated wrappers, nested mapping, arrays, dictionaries, and diagnostics against a live Stone.", "GS_RUN_LIVE_RUST=1 cargo test -p gemstone-rs live_ codegen_"),
      batch(3, "Web worker hardening", 6, 10, "Stabilize SessionWorkerPool, Axum/Actix adapters, tracing, and cautious async boundaries.", "cargo run --manifest-path examples/axum-service/Cargo.toml -- --routes"),
      batch(4, "Release and live CI proof", 4, 7, "Exercise crates.io, VSIX, GitHub Release assets, checksums, and manual/scheduled live workflows.", "scripts/publish_verify.sh <version>; scripts/verify_release_artifacts.py"),
    ],
  },
};

const TARGET_ALIASES = {
  py: "gemstone-js",
  python: "gemstone-js",
  "gemstone-py": "gemstone-js",
  js: "gemstone-js",
  javascript: "gemstone-js",
  typescript: "gemstone-js",
  "gemstone-js": "gemstone-js",
  rs: "gemstone-rs",
  rust: "gemstone-rs",
  "gemstone-rs": "gemstone-rs",
  all: "all",
  everything: "all",
};

const VIEW_ALIASES = {
  summary: "summary",
  scorecard: "scorecard",
  gaps: "gaps",
  gap: "gaps",
  next: "next",
  totals: "totals",
  total: "totals",
  batches: "batches",
  batch: "batches",
  "batch-plan": "batches",
  work: "batches",
};

const SCOPE_ALIASES = {
  full: "full",
  parity: "full",
  product: "full",
  beta: "beta",
  "beta-hardening": "beta",
  hardening: "beta",
};

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    printUsage(process.stdout);
    return;
  }

  const report = buildReport(options.target, options.view, options.scope);
  assertReportBounds(report, options.assertions);
  const contents = formatOutput(report, options.format);
  if (options.output) {
    mkdirSync(dirname(options.output), { recursive: true });
    writeFileSync(options.output, contents, "utf8");
    if (!options.quiet) process.stdout.write(`Wrote comparison report to ${options.output}\n`);
    return;
  }

  if (!options.quiet) process.stdout.write(contents);
}

function parseArgs(args) {
  const options = {
    assertions: { exact: {}, max: {} },
    format: "text",
    help: false,
    output: undefined,
    quiet: false,
    scope: "full",
    target: "gemstone-js",
    view: "summary",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.format = "json";
    } else if (arg === "--markdown") {
      options.format = "markdown";
    } else if (arg === "--format") {
      options.format = parseFormat(requiredArg(args, index, arg));
      index += 1;
    } else if (arg === "--target") {
      options.target = parseTarget(requiredArg(args, index, arg));
      index += 1;
    } else if (arg === "--view") {
      options.view = parseView(requiredArg(args, index, arg));
      index += 1;
    } else if (arg === "--scope") {
      options.scope = parseScope(requiredArg(args, index, arg));
      index += 1;
    } else if (arg === "--assert-total-batches") {
      options.assertions.exact.totalBatches = parseNonNegativeInteger(requiredArg(args, index, arg), arg);
      index += 1;
    } else if (arg === "--assert-hours-min") {
      options.assertions.exact.hoursMin = parseNonNegativeInteger(requiredArg(args, index, arg), arg);
      index += 1;
    } else if (arg === "--assert-hours-max") {
      options.assertions.exact.hoursMax = parseNonNegativeInteger(requiredArg(args, index, arg), arg);
      index += 1;
    } else if (arg === "--max-total-batches") {
      options.assertions.max.totalBatches = parseNonNegativeInteger(requiredArg(args, index, arg), arg);
      index += 1;
    } else if (arg === "--max-hours-min") {
      options.assertions.max.hoursMin = parseNonNegativeInteger(requiredArg(args, index, arg), arg);
      index += 1;
    } else if (arg === "--max-hours-max") {
      options.assertions.max.hoursMax = parseNonNegativeInteger(requiredArg(args, index, arg), arg);
      index += 1;
    } else if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
    } else if (arg === "--full") {
      options.scope = "full";
    } else if (arg === "--beta") {
      options.scope = "beta";
    } else if (arg === "--summary") {
      options.view = "summary";
    } else if (arg === "--scorecard") {
      options.view = "scorecard";
    } else if (arg === "--gaps") {
      options.view = "gaps";
    } else if (arg === "--next") {
      options.view = "next";
    } else if (arg === "--totals") {
      options.view = "totals";
    } else if (arg === "--batches" || arg === "--batch-plan" || arg === "--work") {
      options.view = "batches";
    } else if (arg === "--output" || arg === "-o") {
      options.output = requiredArg(args, index, arg);
      index += 1;
    } else if (!arg.startsWith("-")) {
      const normalized = normalizePositional(arg);
      if (normalized.kind === "target") {
        options.target = normalized.value;
      } else if (normalized.kind === "scope") {
        options.scope = normalized.value;
      } else {
        options.view = normalized.value;
      }
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

function parseFormat(value) {
  if (value === "text" || value === "json" || value === "markdown") return value;
  throw new Error(`Unsupported format ${JSON.stringify(value)}. Expected text, json, or markdown.`);
}

function parseTarget(value) {
  const key = value.toLowerCase();
  if (key in TARGET_ALIASES) return TARGET_ALIASES[key];
  throw new Error(`Unknown comparison target: ${value}`);
}

function parseView(value) {
  const key = value.toLowerCase();
  if (key in VIEW_ALIASES) return VIEW_ALIASES[key];
  throw new Error(`Unknown comparison view: ${value}`);
}

function parseScope(value) {
  const key = value.toLowerCase();
  if (key in SCOPE_ALIASES) return SCOPE_ALIASES[key];
  throw new Error(`Unknown comparison scope: ${value}`);
}

function parseNonNegativeInteger(value, flag) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return Number.parseInt(value, 10);
}

function requiredArg(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function normalizePositional(value) {
  const key = value.toLowerCase();
  if (key in TARGET_ALIASES) return { kind: "target", value: parseTarget(value) };
  if (key in VIEW_ALIASES) return { kind: "view", value: parseView(value) };
  if (key in SCOPE_ALIASES) return { kind: "scope", value: parseScope(value) };
  throw new Error(`Unknown comparison target, view, or scope: ${value}`);
}

function buildReport(target, view, scope = "full") {
  if (target === "all") return buildAllReport(view, scope);
  const info = PROJECTS[target];
  if (!info) throw new Error(`Unknown comparison target: ${target}`);
  const selectedBatches = batchesForScope(info, scope);
  const base = {
    $schema: COMPARISON_REPORT_SCHEMA_PATH,
    schema_version: COMPARISON_REPORT_SCHEMA_VERSION,
    comparison: info.comparison,
    scope,
    view,
    title: info.title,
    answer: answerForScope(info, scope),
    fullGuide: info.fullGuide,
  };
  if (view === "summary") return { ...base, rows: info.rows };
  if (view === "scorecard") return { ...base, ...scorecard(info, selectedBatches) };
  if (view === "gaps") return { ...base, gaps: info.gaps };
  if (view === "next") return { ...base, batch: selectedBatches[0], gap: info.gaps[0] };
  if (view === "totals") return { ...base, ...batchTotals(selectedBatches) };
  if (view === "batches") return { ...base, ...batchTotals(selectedBatches), batches: selectedBatches };
  throw new Error(`Unknown comparison view: ${view}`);
}

function buildAllReport(view, scope = "full") {
  const comparisons = [PROJECTS["gemstone-js"], PROJECTS["gemstone-rs"]];
  const totals = comparisons.reduce(
    (acc, info) => {
      const value = batchTotals(batchesForScope(info, scope));
      acc.totalBatches += value.totalBatches;
      acc.hoursMin += value.hoursMin;
      acc.hoursMax += value.hoursMax;
      return acc;
    },
    { totalBatches: 0, hoursMin: 0, hoursMax: 0 },
  );
  const base = {
    $schema: COMPARISON_REPORT_SCHEMA_PATH,
    schema_version: COMPARISON_REPORT_SCHEMA_VERSION,
    comparison: "all",
    scope,
    view,
    title: "GemStone client ecosystem comparison",
    answer: scope === "beta"
      ? "Use the beta scope to track the narrower hardening work needed before gemstone-js and gemstone-rs are credible beta surfaces beside gemstone-py."
      : "Use gemstone-py for the most mature Python product surface, gemstone-rs for Rust-native services and the shared native core, and gemstone-js for async TypeScript/npm applications.",
    ...totals,
  };
  if (view === "summary" || view === "scorecard") {
    return { ...base, comparisons: comparisons.map((info) => ({ comparison: info.comparison, scope, answer: answerForScope(info, scope), ...batchTotals(batchesForScope(info, scope)) })) };
  }
  if (view === "next") {
    return { ...base, comparisons: comparisons.map((info) => ({ comparison: info.comparison, scope, batch: batchesForScope(info, scope)[0], gap: info.gaps[0] })) };
  }
  if (view === "totals") {
    return { ...base, comparisons: comparisons.map((info) => ({ comparison: info.comparison, scope, ...batchTotals(batchesForScope(info, scope)) })) };
  }
  if (view === "batches") {
    return { ...base, comparisons: comparisons.map((info) => ({ comparison: info.comparison, scope, ...batchTotals(batchesForScope(info, scope)), batches: batchesForScope(info, scope) })) };
  }
  if (view === "gaps") {
    return { ...base, comparisons: comparisons.map((info) => ({ comparison: info.comparison, scope, gaps: info.gaps })) };
  }
  throw new Error(`Unknown comparison view: ${view}`);
}

function answerForScope(info, scope) {
  return scope === "beta" ? info.betaAnswer : info.answer;
}

function batchesForScope(info, scope) {
  return scope === "beta" ? info.betaBatches : info.batches;
}

function scorecard(info, selectedBatches) {
  return {
    gemstonePyUseWhen: info.pyUseWhen,
    projectUseWhen: info.projectUseWhen,
    gemstonePyStrengths: info.pyStrengths,
    projectStrengths: info.projectStrengths,
    ...batchTotals(selectedBatches),
    nextBatch: selectedBatches[0],
    topGap: info.gaps[0],
  };
}

function batchTotals(batches) {
  return batches.reduce(
    (totals, entry) => ({
      totalBatches: totals.totalBatches + 1,
      hoursMin: totals.hoursMin + entry.hoursMin,
      hoursMax: totals.hoursMax + entry.hoursMax,
    }),
    { totalBatches: 0, hoursMin: 0, hoursMax: 0 },
  );
}

function assertReportBounds(report, assertions) {
  const exactEntries = Object.entries(assertions.exact);
  const maxEntries = Object.entries(assertions.max);
  if (exactEntries.length === 0 && maxEntries.length === 0) return;
  if (!("totalBatches" in report) || !("hoursMin" in report) || !("hoursMax" in report)) {
    throw new Error(`Assertions require a report view with totals. Use --view scorecard, totals, or batches.`);
  }
  const fields = {
    totalBatches: "total batches",
    hoursMin: "minimum hours",
    hoursMax: "maximum hours",
  };
  for (const [field, expected] of exactEntries) {
    if (report[field] !== expected) {
      throw new Error(
        `Comparison ${fields[field]} assertion failed: expected ${expected}, found ${report[field]}.`,
      );
    }
  }
  for (const [field, expectedMax] of maxEntries) {
    if (report[field] > expectedMax) {
      throw new Error(
        `Comparison ${fields[field]} maximum threshold failed: expected at most ${expectedMax}, found ${report[field]}.`,
      );
    }
  }
}

function formatOutput(report, format) {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "markdown") return formatMarkdownReport(report);
  return formatReport(report);
}

function formatReport(report) {
  if (report.comparison === "all") return formatAllReport(report);
  if (report.view === "summary") return formatSummary(report);
  if (report.view === "scorecard") return formatScorecard(report);
  if (report.view === "gaps") return formatGaps(report);
  if (report.view === "next") return formatNext(report);
  if (report.view === "totals") return formatTotals(report);
  if (report.view === "batches") return formatBatches(report);
  throw new Error(`Unknown comparison view: ${report.view}`);
}

function formatMarkdownReport(report) {
  if (report.comparison === "all") return formatMarkdownAllReport(report);
  if (report.view === "summary") return formatMarkdownSummary(report);
  if (report.view === "scorecard") return formatMarkdownScorecard(report);
  if (report.view === "gaps") return formatMarkdownGaps(report);
  if (report.view === "next") return formatMarkdownNext(report);
  if (report.view === "totals") return formatMarkdownTotals(report);
  if (report.view === "batches") return formatMarkdownBatches(report);
  throw new Error(`Unknown comparison view: ${report.view}`);
}

function formatMarkdownIntro(report) {
  const lines = [`# ${report.title}`, "", report.answer, ""];
  lines.push(`Scope: \`${report.scope}\``, "");
  if (report.fullGuide) lines.push(`Full guide: \`${report.fullGuide}\``, "");
  return lines;
}

function formatMarkdownSummary(report) {
  const lines = formatMarkdownIntro(report);
  for (const entry of report.rows) {
    lines.push(`## ${entry.topic}`);
    lines.push("");
    lines.push(`- gemstone-py: ${entry.gemstonePy}`);
    lines.push(`- ${report.comparison}: ${entry.project}`);
    lines.push(`- Recommendation: ${entry.recommendation}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function formatMarkdownScorecard(report) {
  const lines = formatMarkdownIntro(report);
  lines.push(`Remaining work: **${report.totalBatches} batches**, roughly **${report.hoursMin}-${report.hoursMax} hours**.`, "");
  appendMarkdownList(lines, "Use gemstone-py when", report.gemstonePyUseWhen);
  appendMarkdownList(lines, `Use ${report.comparison} when`, report.projectUseWhen);
  appendMarkdownList(lines, "gemstone-py strengths", report.gemstonePyStrengths);
  appendMarkdownList(lines, `${report.comparison} strengths`, report.projectStrengths);
  lines.push("## Next Batch", "");
  appendMarkdownBatch(lines, report.nextBatch);
  lines.push("## Top Gap", "");
  appendMarkdownGap(lines, report.topGap, report.comparison);
  return `${lines.join("\n")}\n`;
}

function formatMarkdownGaps(report) {
  const lines = formatMarkdownIntro(report);
  for (const entry of report.gaps) appendMarkdownGap(lines, entry, report.comparison);
  return `${lines.join("\n")}\n`;
}

function formatMarkdownNext(report) {
  const lines = formatMarkdownIntro(report);
  lines.push("## Next Batch", "");
  appendMarkdownBatch(lines, report.batch);
  lines.push("## Top Gap", "");
  appendMarkdownGap(lines, report.gap, report.comparison);
  return `${lines.join("\n")}\n`;
}

function formatMarkdownTotals(report) {
  const lines = formatMarkdownIntro(report);
  lines.push(`Total: **${report.totalBatches} batches**, roughly **${report.hoursMin}-${report.hoursMax} hours**.`);
  return `${lines.join("\n")}\n`;
}

function formatMarkdownBatches(report) {
  const lines = formatMarkdownIntro(report);
  lines.push(`Total: **${report.totalBatches} batches**, roughly **${report.hoursMin}-${report.hoursMax} hours**.`, "");
  for (const entry of report.batches) appendMarkdownBatch(lines, entry);
  return `${lines.join("\n")}\n`;
}

function formatMarkdownAllReport(report) {
  const lines = formatMarkdownIntro(report);
  lines.push(`Combined total: **${report.totalBatches} batches**, roughly **${report.hoursMin}-${report.hoursMax} hours**.`, "");
  for (const comparison of report.comparisons) {
    lines.push(`## ${comparison.comparison}`, "");
    if (comparison.answer) lines.push(comparison.answer, "");
    if ("totalBatches" in comparison) {
      lines.push(`Total: **${comparison.totalBatches} batches**, roughly **${comparison.hoursMin}-${comparison.hoursMax} hours**.`, "");
    }
    if (comparison.batch) appendMarkdownBatch(lines, comparison.batch);
    if (comparison.gap) appendMarkdownGap(lines, comparison.gap, comparison.comparison);
    if (comparison.batches) {
      for (const entry of comparison.batches) appendMarkdownBatch(lines, entry);
    }
    if (comparison.gaps) {
      for (const entry of comparison.gaps) appendMarkdownGap(lines, entry, comparison.comparison);
    }
  }
  return `${lines.join("\n")}\n`;
}

function appendMarkdownList(lines, title, items) {
  lines.push(`## ${title}`, "");
  for (const item of items) lines.push(`- ${item}`);
  lines.push("");
}

function appendMarkdownBatch(lines, entry) {
  lines.push(`### ${entry.number}. ${entry.focus}`, "");
  lines.push(`- Estimate: ${entry.hoursMin}-${entry.hoursMax} hours`);
  lines.push(`- Outcome: ${entry.outcome}`);
  lines.push(`- Verify with: \`${entry.verifyWith}\``);
  lines.push("");
}

function appendMarkdownGap(lines, entry, projectLabel) {
  lines.push(`### ${entry.priority} ${entry.area}`, "");
  lines.push(`- gemstone-py strength: ${entry.gemstonePyStrength}`);
  lines.push(`- ${projectLabel} gap: ${entry.projectGap}`);
  lines.push(`- Next action: ${entry.nextAction}`);
  lines.push(`- Verify with: \`${entry.verifyWith}\``);
  lines.push("");
}

function formatSummary(report) {
  const lines = [report.title, `  Scope: ${report.scope}`, `  Full guide: ${report.fullGuide}`, `  Answer: ${report.answer}`, ""];
  for (const entry of report.rows) {
    lines.push(entry.topic);
    lines.push(`  gemstone-py: ${entry.gemstonePy}`);
    lines.push(`  ${report.comparison}: ${entry.project}`);
    lines.push(`  Recommendation: ${entry.recommendation}`);
    lines.push("");
  }
  lines.push(`Use gemstone-js-compare ${report.comparison} --scorecard for the short decision view.`);
  return `${lines.join("\n")}\n`;
}

function formatScorecard(report) {
  const lines = [report.title, `  Scope: ${report.scope}`, `  Answer: ${report.answer}`, `  Remaining work: ${report.totalBatches} batches, roughly ${report.hoursMin}-${report.hoursMax} hours`, ""];
  appendList(lines, "Use gemstone-py when", report.gemstonePyUseWhen);
  appendList(lines, `Use ${report.comparison} when`, report.projectUseWhen);
  appendList(lines, "gemstone-py strengths", report.gemstonePyStrengths);
  appendList(lines, `${report.comparison} strengths`, report.projectStrengths);
  lines.push(`Next batch: ${report.nextBatch.number}. ${report.nextBatch.focus} (${report.nextBatch.hoursMin}-${report.nextBatch.hoursMax} hours)`);
  lines.push(`  Outcome: ${report.nextBatch.outcome}`);
  lines.push(`  Verify with: ${report.nextBatch.verifyWith}`);
  lines.push(`Top gap: ${report.topGap.priority} ${report.topGap.area}`);
  lines.push(`  Next action: ${report.topGap.nextAction}`);
  return `${lines.join("\n")}\n`;
}

function formatGaps(report) {
  const lines = [`${report.comparison} gaps vs gemstone-py`, `  Scope: ${report.scope}`, `  Full guide: ${report.fullGuide}`, ""];
  for (const entry of report.gaps) appendGap(lines, entry, report.comparison);
  return `${lines.join("\n")}\n`;
}

function formatNext(report) {
  const lines = [`${report.comparison} next recommended batch vs gemstone-py`, `  Scope: ${report.scope}`];
  appendBatch(lines, report.batch);
  lines.push("");
  appendGap(lines, report.gap, report.comparison);
  return `${lines.join("\n")}\n`;
}

function formatTotals(report) {
  return `${report.comparison} remaining work vs gemstone-py\n  Scope: ${report.scope}\n  Total: ${report.totalBatches} batches, roughly ${report.hoursMin}-${report.hoursMax} hours\n`;
}

function formatBatches(report) {
  const lines = [`${report.comparison} remaining batches vs gemstone-py`, `  Scope: ${report.scope}`, `  Total: ${report.totalBatches} batches, roughly ${report.hoursMin}-${report.hoursMax} hours`, ""];
  for (const entry of report.batches) {
    appendBatch(lines, entry);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function formatAllReport(report) {
  const lines = [report.title, `  Scope: ${report.scope}`, `  Answer: ${report.answer}`, `  Combined total: ${report.totalBatches} batches, roughly ${report.hoursMin}-${report.hoursMax} hours`, ""];
  for (const comparison of report.comparisons) {
    if (report.view === "gaps") {
      lines.push(`${comparison.comparison} gaps`);
      for (const entry of comparison.gaps) appendGap(lines, entry, comparison.comparison);
      lines.push("");
    } else if (report.view === "next") {
      lines.push(`${comparison.comparison} next batch`);
      appendBatch(lines, comparison.batch);
      lines.push(`  Top gap: ${comparison.gap.priority} ${comparison.gap.area}`);
      lines.push("");
    } else if (report.view === "batches") {
      lines.push(`${comparison.comparison}: ${comparison.totalBatches} batches, roughly ${comparison.hoursMin}-${comparison.hoursMax} hours`);
      for (const entry of comparison.batches) appendBatch(lines, entry);
      lines.push("");
    } else {
      lines.push(`${comparison.comparison}: ${comparison.totalBatches} batches, roughly ${comparison.hoursMin}-${comparison.hoursMax} hours`);
      if (comparison.answer) lines.push(`  ${comparison.answer}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function appendList(lines, title, items) {
  lines.push(title);
  for (const item of items) lines.push(`  - ${item}`);
  lines.push("");
}

function appendBatch(lines, entry) {
  lines.push(`${entry.number}. ${entry.focus} (${entry.hoursMin}-${entry.hoursMax} hours)`);
  lines.push(`  Outcome: ${entry.outcome}`);
  lines.push(`  Verify with: ${entry.verifyWith}`);
}

function appendGap(lines, entry, projectLabel) {
  lines.push(`${entry.priority} ${entry.area}`);
  lines.push(`  gemstone-py strength: ${entry.gemstonePyStrength}`);
  lines.push(`  ${projectLabel} gap: ${entry.projectGap}`);
  lines.push(`  Next action: ${entry.nextAction}`);
  lines.push(`  Verify with: ${entry.verifyWith}`);
  lines.push("");
}

function row(topic, gemstonePy, project, recommendation) {
  return { topic, gemstonePy, project, recommendation };
}

function gap(priority, area, gemstonePyStrength, projectGap, nextAction, verifyWith) {
  return { priority, area, gemstonePyStrength, projectGap, nextAction, verifyWith };
}

function batch(number, focus, hoursMin, hoursMax, outcome, verifyWith) {
  return { number, focus, hoursMin, hoursMax, outcome, verifyWith };
}

function printUsage(output) {
  output.write(`Usage: gemstone-js-compare [target] [view] [options]

Targets:
  gemstone-js, js, gemstone-py   Compare gemstone-js with gemstone-py
  gemstone-rs, rs, rust          Compare gemstone-rs with gemstone-py
  all                            Print combined gemstone-js and gemstone-rs work

Views:
  summary, scorecard, gaps, next, totals, batches

Options:
  --json                         Print machine-readable output
  --markdown                     Print Markdown output
  --format <format>              Output format: text, json, or markdown
  --target <target>              Explicit target: gemstone-js, gemstone-rs, or all
  --view <view>                  Explicit view: summary, scorecard, gaps, next, totals, or batches
  --scope <scope>                Planning scope: full or beta
  --full                         Use the full product-parity scope
  --beta                         Use the narrower beta-hardening scope
  --assert-total-batches <n>     Fail unless the selected report has this batch count
  --assert-hours-min <n>         Fail unless the selected report has this minimum-hour total
  --assert-hours-max <n>         Fail unless the selected report has this maximum-hour total
  --max-total-batches <n>        Fail if the selected report has more than this many batches
  --max-hours-min <n>            Fail if the selected report's minimum hours exceeds this value
  --max-hours-max <n>            Fail if the selected report's maximum hours exceeds this value
  -q, --quiet                    Suppress normal report output on success
  -o, --output <path>            Write the selected report to a file
  --summary                      Print the comparison summary
  --scorecard                    Print the short decision view
  --gaps                         Print actionable gap rows
  --next                         Print the next recommended batch
  --totals                       Print batch and hour totals only
  --batches                      Print the full batch plan
  -h, --help                     Show this help
`);
}
