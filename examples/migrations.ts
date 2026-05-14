import { pathToFileURL } from "node:url";
import {
  PersistentRoot,
  Session,
  formatMigrationResult,
  formatMigrationStatus,
  migrationStatus,
  upgrade,
  type MigrationStep,
} from "gemstone-js";

export const migrations: MigrationStep[] = [
  {
    id: "001_example_settings",
    checksum: "example-settings-v1",
    description: "Create example settings entries.",
    async upgrade(session) {
      const root = PersistentRoot.userGlobals(session);
      await root.setValue("ExampleAppVersion", "1");
      await root.setDict("ExampleAppSettings", {
        enabled: true,
        maxRetries: 3,
        tags: ["example", "migration"],
      });
    },
    async downgrade(session) {
      await PersistentRoot.userGlobals(session).removeAll([
        "ExampleAppSettings",
        "ExampleAppVersion",
      ]);
    },
  },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await using session = await Session.connect(Session.configFromEnv());
  const dryRun = process.env.DRY_RUN === "1";

  console.log(formatMigrationStatus(await migrationStatus(session, migrations)));
  const result = await upgrade(session, migrations, {
    dryRun,
    lockOwner: "gemstone-js-example",
    recordDryRun: dryRun,
  });
  console.log(formatMigrationResult(result));

  if (result.dryRun) await session.abort();
}
