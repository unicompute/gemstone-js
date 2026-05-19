#!/usr/bin/env node

import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const outputDir = "artifacts/docs/pdf";
const documents = [
  ["README.md", "gemstone-js-readme.pdf", "gemstone-js README"],
  ["docs/architecture.md", "architecture.pdf", "Architecture"],
  ["docs/beta.md", "beta-guide.pdf", "Beta Guide"],
  ["docs/benchmarks.md", "benchmarks.pdf", "Benchmarks"],
  ["docs/doctor.md", "doctor.pdf", "Doctor"],
  ["docs/examples-guide.md", "examples-guide.pdf", "Examples Guide"],
  ["docs/framework-adapters.md", "framework-adapters.pdf", "Framework Adapters"],
  ["docs/gemstone-js-vs-gemstone-py.md", "gemstone-js-vs-gemstone-py.pdf", "gemstone-js vs gemstone-py"],
  ["docs/gemstone-py-parity.md", "gemstone-py-parity.pdf", "gemstone-py Parity"],
  ["docs/gemstone-rs-comparison.md", "gemstone-rs-comparison.pdf", "gemstone-rs Comparison"],
  ["docs/migrations.md", "migrations.pdf", "Migrations"],
  ["docs/naming.md", "naming.pdf", "Naming"],
  ["docs/releasing.md", "releasing.pdf", "Releasing"],
  ["vscode-gemstone-js-workbench/README.md", "vscode-gemstone-js-workbench-readme.pdf", "VS Code Workbench README"],
  ["vscode-gemstone-js-workbench/CHANGELOG.md", "vscode-gemstone-js-workbench-changelog.pdf", "VS Code Workbench Changelog"],
  ["docs/articles/medium-gemstone-js-workbench.md", "medium-gemstone-js-workbench.pdf", "Medium Article: gemstone-js Workbench"],
];

mkdirSync(outputDir, { recursive: true });

for (const [input, outputName, title] of documents) {
  if (!existsSync(input)) {
    console.warn(`Skipping missing document: ${input}`);
    continue;
  }
  const outputPath = join(outputDir, outputName);
  mkdirSync(dirname(outputPath), { recursive: true });
  run("pandoc", [
    input,
    "--from=gfm",
    "--pdf-engine=xelatex",
    "--resource-path=.:docs:docs/articles:docs/articles/assets:vscode-gemstone-js-workbench",
    "--metadata",
    `title=${title}`,
    "--variable",
    "geometry:margin=0.8in",
    "--variable",
    "colorlinks=true",
    "--variable",
    "linkcolor=blue",
    "--variable",
    "urlcolor=blue",
    "--output",
    outputPath,
  ]);
  console.log(`Wrote ${outputPath}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}
