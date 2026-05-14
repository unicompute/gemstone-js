# Examples Guide

`gemstone-js` ships a small installed example catalog. The catalog is meant to
serve two jobs: quick local discovery from an installed package, and stable file
paths that release checks can verify before publishing.

## Discovery

```sh
gemstone-js-examples
gemstone-js-examples --json
gemstone-js-examples --kind web
gemstone-js-examples --commands
gemstone-js-examples --plans
```

Use `--show <name>` to print a packaged example and `--path <name>` to resolve
its installed file path:

```sh
gemstone-js-examples --show quickstart
gemstone-js-examples --path web-fetch
```

The command list intentionally includes only examples that can be run directly.
Reference fixtures such as generated wrapper output and route-handler modules
stay visible in the catalog but do not get direct run commands.

## Guided Plans

The plan view groups examples by workflow:

```sh
gemstone-js-examples --plan first-session
gemstone-js-examples --commands --plan data-persistence
gemstone-js-examples --json --plan web-service
```

Current plans:

- `first-session`: connect, evaluate, and write/read ObjectLog entries.
- `data-persistence`: roots, dictionaries, query helpers, GStore, and migrations.
- `typed-codegen`: manifests, decorated source, and generated wrappers.
- `web-service`: Fetch, route-handler, Express, Fastify, and Hono shapes.
- `ops-release`: migration, ObjectLog, and codegen checks used before release.

## Environment

Live examples use the same `GS_*` environment as `Session.configFromEnv()`:

```sh
export GS_STONE=gs64stone
export GS_NETLDI=netldi
export GS_HOST=localhost
export GS_USERNAME=DataCurator
export GS_PASSWORD=swordfish
```

The committed check path does not connect to GemStone:

```sh
npm run examples:check
```

That check syntax-checks TypeScript examples, parses JSON examples, validates
catalog metadata, validates guided plans, and fails if an example file is not in
the catalog.

## Web Examples

The dependency-free Fetch example is the smallest web service shape:

```sh
node --experimental-strip-types examples/web-fetch.ts
```

Framework examples show the same request/session lifecycle through common Node
frameworks:

```sh
npm install express
node --experimental-strip-types examples/web-express.ts

npm install fastify
node --experimental-strip-types examples/web-fastify.ts

npm install hono @hono/node-server
node --experimental-strip-types examples/web-hono.ts
```

Route-handler frameworks can start from `examples/web-route-handler.ts`, which
exports `GET()` and `POST()` functions around the Fetch adapter.
