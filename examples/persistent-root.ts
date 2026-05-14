import { PersistentRoot, Session } from "gemstone-js";

await using session = await Session.connect(Session.configFromEnv());

const root = PersistentRoot.userGlobals(session);

try {
  const settings = await root.setDict("ExampleRootSettings", {
    region: "eu-west",
    enabled: true,
    limits: [10, 25, 100],
  });

  await settings.setAllValue({
    owner: "platform",
    status: "ready",
  });

  const values = await settings.values();
  const items = await settings.items();
  const rawItems = await settings.itemsOop();
  const requiredSettings = await root.requireDict("ExampleRootSettings");

  console.log({
    keys: await requiredSettings.keys(),
    values,
    items,
    rawItemCount: rawItems.length,
  });
} finally {
  await session.abort().catch(() => undefined);
}
