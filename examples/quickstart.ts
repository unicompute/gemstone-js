import { Session } from "../src/index.ts";

await using session = await Session.connect(Session.configFromEnv());

const result = await session.eval("1 + 1");
console.log(result);
