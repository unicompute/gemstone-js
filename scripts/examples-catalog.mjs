export const exampleCatalog = [
  {
    name: "quickstart",
    path: "examples/quickstart.ts",
    kind: "basic",
    description: "Minimal connect/evaluate/logout flow using Session.configFromEnv().",
    command: "node --experimental-strip-types examples/quickstart.ts",
  },
  {
    name: "maglev-branch-usage",
    path: "examples/maglev-branch-usage.ts",
    kind: "basic",
    description: "GemStone-Pharo-Bridge MagLev branch session examples translated to GBS-style JavaScript.",
    command: "node --experimental-strip-types examples/maglev-branch-usage.ts",
  },
  {
    name: "gstore",
    path: "examples/gstore.ts",
    kind: "data",
    description: "Named JSON key/value store with transaction callbacks and read-only snapshots.",
    command: "node --experimental-strip-types examples/gstore.ts",
  },
  {
    name: "persistent-root",
    path: "examples/persistent-root.ts",
    kind: "data",
    description: "UserGlobals and GsDict value/raw item access through persistent root helpers.",
    command: "node --experimental-strip-types examples/persistent-root.ts",
  },
  {
    name: "object-mapping",
    path: "examples/object-mapping.ts",
    kind: "data",
    description: "Transparent-ish mapped object helper with async property methods, object selectors, and snapshots.",
    command: "node --experimental-strip-types examples/object-mapping.ts",
  },
  {
    name: "transparent-object-mapping",
    path: "examples/transparent-object-mapping.ts",
    kind: "data",
    description: "Awaitable property proxy with relationship handles, queued writes, and bounded snapshots.",
    command: "node --experimental-strip-types examples/transparent-object-mapping.ts",
  },
  {
    name: "smalltalk-bridge",
    path: "examples/smalltalk-bridge.ts",
    kind: "data",
    description: "Python-style Smalltalk bridge with lazy globals and underscore-to-colon selector dispatch.",
    command: "node --experimental-strip-types examples/smalltalk-bridge.ts",
  },
  {
    name: "query",
    path: "examples/query.ts",
    kind: "query",
    description: "GSCollection search, first, count, exists, limit, and chunked value iteration.",
    command: "node --experimental-strip-types examples/query.ts",
  },
  {
    name: "bulk-perform",
    path: "examples/bulk-perform.ts",
    kind: "query",
    description: "Raw, marshalled-value, object-handle, and mixed-call bulk selector sends.",
    command: "node --experimental-strip-types examples/bulk-perform.ts",
  },
  {
    name: "booking",
    path: "examples/booking.ts",
    kind: "codegen",
    description: "Typed domain model used by the generated wrapper examples.",
  },
  {
    name: "codegen-manifest",
    path: "examples/codegen.manifest.json",
    kind: "codegen",
    description: "Hand-written codegen manifest with typed imports and wrapper output.",
    command: "npm run codegen:check",
  },
  {
    name: "codegen-generated",
    path: "examples/codegen.generated.ts",
    kind: "codegen",
    description: "Generated wrappers rendered from the JSON manifest.",
  },
  {
    name: "booking-decorators",
    path: "examples/booking.decorators.ts",
    kind: "codegen",
    description: "Decorated source scanned by the codegen scanner.",
    command: "npm run codegen:scan:check",
  },
  {
    name: "booking-decorators-generated",
    path: "examples/booking.decorators.generated.ts",
    kind: "codegen",
    description: "Generated wrappers rendered from decorated source.",
  },
  {
    name: "migrations",
    path: "examples/migrations.ts",
    kind: "ops",
    description: "Exported migration manifest plus direct status and dry-run execution flow.",
    command: "DRY_RUN=1 node --experimental-strip-types examples/migrations.ts",
  },
  {
    name: "object-log",
    path: "examples/object-log.ts",
    kind: "ops",
    description: "ObjectLog writes, latest-entry fetches, counts, summaries, and level-aware filtering.",
    command: "node --experimental-strip-types examples/object-log.ts",
  },
  {
    name: "web-express",
    path: "examples/web-express.ts",
    kind: "web",
    description: "Express service with pooled request sessions, health, and ObjectLog routes.",
    requires: ["express"],
    command: "node --experimental-strip-types examples/web-express.ts",
  },
  {
    name: "web-fastify",
    path: "examples/web-fastify.ts",
    kind: "web",
    description: "Fastify service with pooled request sessions, health, and ObjectLog routes.",
    requires: ["fastify"],
    command: "node --experimental-strip-types examples/web-fastify.ts",
  },
  {
    name: "web-fetch",
    path: "examples/web-fetch.ts",
    kind: "web",
    description: "Dependency-free Fetch API service with pooled request sessions, health, and ObjectLog routes.",
    command: "node --experimental-strip-types examples/web-fetch.ts",
  },
  {
    name: "explorer",
    path: "examples/explorer.ts",
    kind: "web",
    description: "Dependency-free browser explorer for doctor/status, OOP inspection, roots/globals, workspace eval, class browsing, and codegen preview.",
    command: "node --experimental-strip-types examples/explorer.ts",
  },
  {
    name: "web-route-handler",
    path: "examples/web-route-handler.ts",
    kind: "web",
    description: "Fetch adapter route-handler exports for Node-based frameworks such as Next.js route handlers.",
  },
  {
    name: "web-hono",
    path: "examples/web-hono.ts",
    kind: "web",
    description: "Hono service with pooled request sessions, health, and ObjectLog routes.",
    requires: ["hono", "@hono/node-server"],
    command: "node --experimental-strip-types examples/web-hono.ts",
  },
];

export const examplePlans = [
  {
    name: "first-session",
    title: "First Session",
    description: "Connect, evaluate a simple expression, and inspect ObjectLog behavior.",
    examples: ["quickstart", "maglev-branch-usage", "object-log"],
  },
  {
    name: "data-persistence",
    title: "Data Persistence",
    description: "Work through roots, dictionaries, query helpers, GStore, and migrations.",
    examples: ["persistent-root", "object-mapping", "transparent-object-mapping", "smalltalk-bridge", "query", "bulk-perform", "gstore", "migrations"],
  },
  {
    name: "typed-codegen",
    title: "Typed Code Generation",
    description: "Review hand-written manifests, decorated source scanning, and generated wrappers.",
    examples: [
      "booking",
      "codegen-manifest",
      "codegen-generated",
      "booking-decorators",
      "booking-decorators-generated",
    ],
  },
  {
    name: "web-service",
    title: "Web Service",
    description: "Start with Fetch and the local explorer, then compare Express, Fastify, Hono, and route-handler shapes.",
    examples: ["web-fetch", "explorer", "web-route-handler", "web-express", "web-fastify", "web-hono"],
  },
  {
    name: "ops-release",
    title: "Operations And Release",
    description: "Use the local verification and operations examples before publishing or deploying.",
    examples: ["migrations", "object-log", "codegen-manifest", "booking-decorators"],
  },
];

export function findExample(name) {
  return exampleCatalog.find((entry) => entry.name === name);
}

export function findExamplePlan(name) {
  return examplePlans.find((entry) => entry.name === name);
}
