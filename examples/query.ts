import { GSCollection, Session } from "gemstone-js";

await using session = await Session.connect(Session.configFromEnv());

try {
  await session.execute(`
    UserGlobals at: #ExampleQueryItems put: OrderedCollection new.
  `);

  const items = new GSCollection<string>(session, "ExampleQueryItems");
  await items.addAll(["new", "ready", "reviewing", "closed", "archived"]);

  const firstLongValue = await items.firstValue("size", ">=", 6);
  const limitedValues = await items.limitValues("size", ">=", 5, 3);
  const matchCount = await items.count("size", ">=", 5);
  const hasArchived = await items.exists("size", "=", 8);
  const chunkedValues: unknown[] = [];

  for await (const value of items.iterValues(2)) {
    chunkedValues.push(value);
  }

  console.log({
    firstLongValue,
    limitedValues,
    matchCount,
    hasArchived,
    chunkedValues,
  });
} finally {
  await session.abort().catch(() => undefined);
}
