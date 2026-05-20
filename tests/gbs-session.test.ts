import assert from "node:assert/strict";
import test from "node:test";

import {
  GbsSessionParameters,
  gbsSessionParameters,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

test("GbsSessionParameters mirrors the classic MagLev branch session example", async () => {
  const runtime = new MockGciRuntime();
  const session = await gbsSessionParameters({ runtime })
    .name("Simple Session")
    .gemStoneName("gs64stone")
    .username("DataCurator")
    .password("secret")
    .login();

  assert.equal(session.name, "Simple Session");
  assert.equal(session.userGlobals.rootName, "UserGlobals");

  await session.userGlobals.atPut("MyTestDict", {
    name: "Tariq",
    amount: 100,
    currency: "GBP",
  });
  assert.equal(await session.userGlobals.includesKey("MyTestDict"), true);

  const stored = await session.userGlobals.atDict("MyTestDict");
  assert(stored);
  assert.equal(await stored.get("name"), "Tariq");
  assert.equal(await stored.get("amount"), 100n);
  assert.equal(await stored.get("currency"), "GBP");

  await session.commit();
  await session.disconnect();

  const login = runtime.calls.find((call) => call.method === "loginEx");
  assert.equal((login?.args[0] as { stone?: string } | undefined)?.stone, "gs64stone");
  assert.equal((login?.args[0] as { netldi?: string } | undefined)?.netldi, "netldi");
  assert.equal((login?.args[0] as { host?: string } | undefined)?.host, "localhost");
  assert.equal((login?.args[0] as { username?: string } | undefined)?.username, "DataCurator");
  assert.equal((login?.args[0] as { password?: string } | undefined)?.password, "secret");
  assert(runtime.calls.some((call) => call.method === "commit"));
  assert(runtime.calls.some((call) => call.method === "logout"));
});

test("GbsSession exposes MagLev-oriented bridgeRoot and explicit commit helpers", async () => {
  const runtime = new MockGciRuntime();
  const session = await new GbsSessionParameters({ runtime })
    .name("MagLev Session")
    .gemStoneName("gs64stone")
    .username("DataCurator")
    .password("secret")
    .netldiHostOrIp("localhost")
    .netldiNameOrPort("50377")
    .login();

  assert.equal(session.bridgeRoot, session.userGlobals);
  await session.bridgeRoot.atPut("MyTestDict", {
    name: "Tariq",
    amount: 100,
    currency: "GBP",
  });
  await session.commitTransactionOrSignalConflict();

  let attempts = 0;
  const result = await session.commitTransactionWithRetryCount(2, async (current) => {
    attempts += 1;
    await current.bridgeRoot.atPut("MyRetryDict", { status: "ready" });
    return "committed";
  });

  assert.equal(result, "committed");
  assert.equal(attempts, 1);
  const retryDict = await session.bridgeRoot.atDict("MyRetryDict");
  assert.equal(await retryDict?.get("status"), "ready");

  await session.disconnect();

  const login = runtime.calls.find((call) => call.method === "loginEx");
  assert.equal((login?.args[0] as { netldi?: string } | undefined)?.netldi, "50377");
  assert.equal((login?.args[0] as { host?: string } | undefined)?.host, "localhost");
  assert.equal(runtime.calls.filter((call) => call.method === "commit").length, 2);
});
