# Framework Adapters

`gemstone-js` keeps framework integration thin. Express, Fastify, and Hono all
delegate request lifetime to `RequestScope`, so transaction policy, pool
release, abort-on-error, abort-on-status, and owned-session logout stay in one
place.

## Request Lifecycle

The adapters attach the active `Session` and `RequestScope` to the framework
request context:

| Framework | Session handle | Scope handle |
| --- | --- | --- |
| Express | `req.gemstoneSession` | `req.gemstoneScope` |
| Fastify | `request.gemstoneSession` | `request.gemstoneScope` |
| Hono | `c.get("gemstoneSession")` | `c.get("gemstoneScope")` |

By default, successful responses commit and failed responses abort. A response
status greater than or equal to `serverErrorStatus` is treated as failed. Use
`transactionPolicy: "abortOnExit"` for read-mostly routes that should always
discard changes, or `transactionPolicy: "manual"` when handlers commit or abort
explicitly.

## Examples

Each example uses a shared `SessionPool`, exposes `/health/gemstone`, writes an
`ObjectLog` entry at `POST /object-log`, and closes the pool on process
shutdown:

```sh
gemstone-js-examples
gemstone-js-examples --show web-express
```

```sh
npm install express
node --experimental-strip-types examples/web-express.ts
```

```sh
npm install fastify
node --experimental-strip-types examples/web-fastify.ts
```

```sh
npm install hono @hono/node-server
node --experimental-strip-types examples/web-hono.ts
```

The examples rely on the usual GemStone environment variables accepted by
`Session.configFromEnv()`: `GS_STONE`, `GS_NETLDI`, `GS_HOST`,
`GS_USERNAME`, `GS_PASSWORD`, and related host-login settings.
`npm run examples:check` syntax-checks the committed examples without requiring
the optional framework packages to be installed.

## Adapter Notes

Pass an existing `SessionPool` when the framework owns process lifetime and
needs explicit startup/shutdown hooks. Passing pool options directly to the
adapter is useful for small services where the adapter can own the pool.

Do not retry an already-running HTTP request scope after a commit conflict
unless the entire request body and external side effects can be replayed. Use
`retryingTransaction()` around a smaller idempotent unit of work instead.
