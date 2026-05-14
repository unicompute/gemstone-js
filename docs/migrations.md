# Migrations

`gemstone-js` includes a small module-style migration runner for application
schema/data changes. Migration metadata is stored as JSON under
`UserGlobals.GemstoneJsMigrations`; the advisory lock is stored under
`UserGlobals.GemstoneJsMigrationsLock`.

```ts
import type { MigrationStep } from "gemstone-js";

export const migrations: MigrationStep[] = [
  {
    id: "001_initial",
    description: "Create the application flag.",
    async upgrade(session) {
      await session.globalSet("BookingMigrationFlag", "ready");
    },
    async downgrade(session) {
      await session.globalRemove("BookingMigrationFlag");
    },
  },
];
```

Run from code:

```ts
import { Session, upgrade, currentVersion } from "gemstone-js";
import { migrations } from "./migrations.ts";

await using session = await Session.connect(Session.configFromEnv());
await upgrade(session, migrations, { lockOwner: "deploy" });
console.log(await currentVersion(session));
```

Or use the CLI:

```sh
npm run migrations -- status --manifest ./migrations.ts
npm run migrations -- plan --manifest ./migrations.ts
npm run migrations -- upgrade --manifest ./migrations.ts --dry-run --record
npm run migrations -- upgrade --manifest ./migrations.ts --lock-owner deploy
npm run migrations -- downgrade --manifest ./migrations.ts --target base
```

The runner validates dependency order, duplicate ids, unknown applied ids, and
checksum drift before applying more migrations. Each applied step is committed
after its metadata is written. Failures abort the active transaction and release
the migration lock when possible.
