export const exampleCatalog = [
  {
    name: "quickstart",
    path: "examples/quickstart.ts",
    kind: "basic",
    description: "Minimal connect/evaluate/logout flow using Session.configFromEnv().",
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
