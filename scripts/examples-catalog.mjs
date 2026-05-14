export const exampleCatalog = [
  {
    name: "quickstart",
    path: "examples/quickstart.ts",
    kind: "basic",
    description: "Minimal connect/evaluate/logout flow using Session.configFromEnv().",
  },
  {
    name: "gstore",
    path: "examples/gstore.ts",
    kind: "data",
    description: "Named JSON key/value store with transaction callbacks and read-only snapshots.",
  },
  {
    name: "persistent-root",
    path: "examples/persistent-root.ts",
    kind: "data",
    description: "UserGlobals and GsDict value/raw item access through persistent root helpers.",
  },
  {
    name: "query",
    path: "examples/query.ts",
    kind: "query",
    description: "GSCollection search, first, count, exists, limit, and chunked value iteration.",
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
  },
  {
    name: "object-log",
    path: "examples/object-log.ts",
    kind: "ops",
    description: "ObjectLog writes, entry fetches, and level-aware display.",
  },
  {
    name: "web-express",
    path: "examples/web-express.ts",
    kind: "web",
    description: "Express service with pooled request sessions, health, and ObjectLog routes.",
    requires: ["express"],
  },
  {
    name: "web-fastify",
    path: "examples/web-fastify.ts",
    kind: "web",
    description: "Fastify service with pooled request sessions, health, and ObjectLog routes.",
    requires: ["fastify"],
  },
  {
    name: "web-hono",
    path: "examples/web-hono.ts",
    kind: "web",
    description: "Hono service with pooled request sessions, health, and ObjectLog routes.",
    requires: ["hono", "@hono/node-server"],
  },
];

export function findExample(name) {
  return exampleCatalog.find((entry) => entry.name === name);
}
