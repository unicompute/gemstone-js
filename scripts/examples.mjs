#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exampleCatalog, examplePlans, findExample, findExamplePlan } from "./examples-catalog.mjs";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    printUsage(process.stdout);
    return;
  }
  const selectedPlan = options.plan ? requirePlan(options.plan) : undefined;
  const selectedExamples = selectedPlan ? examplesForPlan(selectedPlan, options.kind) : filterExamples(options.kind);
  if (options.json) {
    if (selectedPlan) {
      process.stdout.write(`${JSON.stringify(planReport(selectedPlan, selectedExamples), null, 2)}\n`);
    } else if (options.plans) {
      process.stdout.write(`${JSON.stringify(examplePlans, null, 2)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(selectedExamples, null, 2)}\n`);
    }
    return;
  }
  if (options.commands) {
    process.stdout.write(formatCommands(selectedExamples));
    return;
  }
  if (options.plans) {
    process.stdout.write(formatPlans(examplePlans));
    return;
  }
  if (selectedPlan) {
    process.stdout.write(formatPlan(selectedPlan, selectedExamples));
    return;
  }
  if (options.show) {
    const example = requireExample(options.show, options.kind);
    process.stdout.write(readFileSync(join(PACKAGE_ROOT, example.path), "utf8"));
    return;
  }
  if (options.path) {
    const example = requireExample(options.path, options.kind);
    process.stdout.write(`${join(PACKAGE_ROOT, example.path)}\n`);
    return;
  }

  process.stdout.write(formatExamples(selectedExamples));
}

function parseArgs(args) {
  const options = {
    help: false,
    commands: false,
    json: false,
    kind: undefined,
    plan: undefined,
    plans: false,
    path: undefined,
    show: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--commands") {
      options.commands = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--kind") {
      options.kind = requiredArg(args, index, arg);
      index += 1;
    } else if (arg === "--plan") {
      options.plan = requiredArg(args, index, arg);
      index += 1;
    } else if (arg === "--plans") {
      options.plans = true;
    } else if (arg === "--show") {
      options.show = requiredArg(args, index, arg);
      index += 1;
    } else if (arg === "--path") {
      options.path = requiredArg(args, index, arg);
      index += 1;
    } else if (!arg.startsWith("-") && !options.show) {
      options.show = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

function requiredArg(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function filterExamples(kind) {
  if (!kind) return exampleCatalog;
  const examples = exampleCatalog.filter((entry) => entry.kind === kind);
  if (examples.length === 0) {
    const kinds = [...new Set(exampleCatalog.map((entry) => entry.kind))].sort().join(", ");
    throw new Error(`Unknown example kind ${JSON.stringify(kind)}. Available kinds: ${kinds}.`);
  }
  return examples;
}

function examplesForPlan(plan, kind) {
  const examples = plan.examples.map((name) => requireExample(name, undefined));
  return kind ? examples.filter((entry) => entry.kind === kind) : examples;
}

function requireExample(name, kind) {
  const example = findExample(name);
  if (!example) {
    throw new Error(`Unknown example ${JSON.stringify(name)}. Run gemstone-js-examples --json to list examples.`);
  }
  if (kind && example.kind !== kind) {
    throw new Error(`Example ${JSON.stringify(name)} is kind ${JSON.stringify(example.kind)}, not ${JSON.stringify(kind)}.`);
  }
  return example;
}

function requirePlan(name) {
  const plan = findExamplePlan(name);
  if (!plan) {
    throw new Error(`Unknown example plan ${JSON.stringify(name)}. Run gemstone-js-examples --plans to list plans.`);
  }
  return plan;
}

function planReport(plan, examples) {
  return {
    ...plan,
    entries: examples,
  };
}

function formatExamples(examples) {
  if (examples.length === 0) return "No gemstone-js examples matched.\n";
  const width = Math.max(...examples.map((entry) => entry.name.length));
  const lines = ["Available gemstone-js examples:"];
  for (const entry of examples) {
    const requirements = entry.requires?.length ? ` Requires: ${entry.requires.join(", ")}.` : "";
    const command = entry.command ? ` Run: ${entry.command}.` : "";
    lines.push(`  ${entry.name.padEnd(width)}  ${entry.path}  ${entry.description}${requirements}${command}`);
  }
  lines.push("");
  lines.push("Use gemstone-js-examples --show <name> to print an example.");
  lines.push("Use gemstone-js-examples --commands [--kind <kind>] to print runnable commands.");
  return `${lines.join("\n")}\n`;
}

function formatPlans(plans) {
  const width = Math.max(...plans.map((entry) => entry.name.length));
  const lines = ["Available gemstone-js example plans:"];
  for (const plan of plans) {
    lines.push(`  ${plan.name.padEnd(width)}  ${plan.title}  ${plan.description}`);
  }
  lines.push("");
  lines.push("Use gemstone-js-examples --plan <name> to print a plan.");
  lines.push("Use gemstone-js-examples --commands --plan <name> to print runnable commands for a plan.");
  return `${lines.join("\n")}\n`;
}

function formatPlan(plan, examples) {
  const lines = [
    `${plan.title} (${plan.name})`,
    plan.description,
    "",
  ];
  for (const entry of examples) {
    lines.push(`${entry.name}  ${entry.path}`);
    lines.push(`  ${entry.description}`);
    if (entry.requires?.length) lines.push(`  Requires: ${entry.requires.join(", ")}`);
    if (entry.command) lines.push(`  Run: ${entry.command}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatCommands(examples) {
  const runnable = examples.filter((entry) => entry.command);
  if (runnable.length === 0) return "No runnable gemstone-js examples matched.\n";
  const width = Math.max(...runnable.map((entry) => entry.name.length));
  const lines = ["Runnable gemstone-js examples:"];
  for (const entry of runnable) {
    if (entry.requires?.length) {
      lines.push(`# ${entry.name}: npm install ${entry.requires.join(" ")}`);
    }
    lines.push(`${entry.name.padEnd(width)}  ${entry.command}`);
  }
  return `${lines.join("\n")}\n`;
}

function printUsage(output) {
  output.write(`Usage: gemstone-js-examples [options] [name]

Options:
  --json             Print the example catalog as JSON
  --commands         Print runnable example commands
  --kind <kind>      Filter by example kind
  --plans            List guided example plans
  --plan <name>      Print one guided example plan
  --show <name>      Print an example file
  --path <name>      Print an example file path
  -h, --help         Show this help
`);
}
