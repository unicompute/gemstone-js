import { ObjectLog, Session } from "gemstone-js";

await using session = await Session.connect(Session.configFromEnv());

const objectLog = new ObjectLog(session);

await objectLog.info("gemstone-js example started");
await objectLog.debug("gemstone-js example debug detail");

const recentEntries = (await objectLog.entries()).slice(-5);
for (const entry of recentEntries) {
  console.log(`${entry.index}: [${entry.levelName}] ${entry.label}`);
}
