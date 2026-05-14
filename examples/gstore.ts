import { GStore, Session, type GStoreJsonValue } from "gemstone-js";

await using session = await Session.connect(Session.configFromEnv());

const store = await GStore.open(session, "ExampleAppSettings");

await store.transaction((transaction) => {
  transaction.setAll({
    release: {
      enabled: true,
      rolloutPercent: 10,
      cohorts: ["internal", "beta"],
    },
    owner: "platform",
  });
});

const snapshot = await store.transaction(
  (transaction): Record<string, GStoreJsonValue> => transaction.toObject(),
  { readOnly: true },
);

console.log(snapshot?.release);
