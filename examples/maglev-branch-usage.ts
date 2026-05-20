import { gbsSessionParameters } from "gemstone-js";

const payload = {
  name: "Tariq",
  amount: 100,
  currency: "GBP",
};

await classicSessionExample();
await maglevOrientedSessionExample();

async function classicSessionExample(): Promise<void> {
  const session = await sessionParameters("Simple Session").login();
  try {
    await session.userGlobals.atPut("MyTestDict", payload);
    await session.commit();

    const stored = await session.userGlobals.atDict("MyTestDict");
    console.log({
      example: "classic",
      root: session.userGlobals.rootName,
      value: stored ? await stored.toObject() : null,
    });
  } finally {
    await session.disconnect();
  }
}

async function maglevOrientedSessionExample(): Promise<void> {
  const session = await sessionParameters("MagLev Session")
    .netldiHostOrIp(envValue("GS_NETLDI_HOST", "GS_HOST") ?? "localhost")
    .netldiNameOrPort(envValue("GS_NETLDI_NAME_OR_PORT", "GS_NETLDI") ?? "netldi")
    .login();

  try {
    await session.bridgeRoot.atPut("MyTestDict", payload);
    await session.commitTransactionOrSignalConflict();

    const stored = await session.bridgeRoot.atDict("MyTestDict");
    console.log({
      example: "maglev",
      root: session.bridgeRoot.rootName,
      value: stored ? await stored.toObject() : null,
    });
  } finally {
    await session.disconnect();
  }
}

function sessionParameters(name: string) {
  const parameters = gbsSessionParameters()
    .name(name)
    .gemStoneName(envValue("GS_STONE", "GS_STONE_NAME") ?? "gs64stone")
    .username(envValue("GS_USERNAME", "GS_USER") ?? "DataCurator");

  const password = envValue("GS_PASSWORD", "GS_PASS");
  if (password !== undefined) parameters.password(password);
  return parameters;
}

function envValue(...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}
