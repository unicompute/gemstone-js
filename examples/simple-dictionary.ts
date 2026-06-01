import { Session } from "gemstone-js";

const key = "MyTestDict";

await Session.withEnv(async (session) => {
  await session.globalSetDict(key, {
    name: "Tariq",
    amount: 100,
    currency: "GBP",
  });
  await session.commit();
});

const saved = await Session.withEnv((session) =>
  session.globalRequireDictObject(key, { maxEntries: 50 })
);

console.log(saved);
// { name: "Tariq", amount: 100n, currency: "GBP" }
