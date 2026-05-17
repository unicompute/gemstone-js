import { ObjectLog, formatObjectLogEntry, Session } from "gemstone-js";

await using session = await Session.connect(Session.configFromEnv());

const objectLog = new ObjectLog(session);

await objectLog.info("gemstone-js example started");
await objectLog.debug("gemstone-js example debug detail");

console.log({
  hasEntries: await objectLog.hasEntries(),
  debugCount: await objectLog.countFor("debug"),
  recentSummary: await objectLog.summarize({ order: "newest", maxEntries: 10 }),
});

const recentEntries = await objectLog.entries({ order: "newest", maxEntries: 5 });
for (const entry of recentEntries) {
  console.log(formatObjectLogEntry(entry, { includeTimestamp: true }));
}

const recentDebugEntries = await objectLog.entries({ level: "debug", order: "newest", maxEntries: 5 });
console.log(`recent debug entries: ${recentDebugEntries.length}`);
