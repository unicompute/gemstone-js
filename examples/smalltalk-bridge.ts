import { Session, smalltalkBridge } from "gemstone-js";

await using session = await Session.connect(Session.configFromEnv());

const st = smalltalkBridge(session);
type GemStoneArrayProxy = {
  size: PromiseLike<number>;
};

const repositoryName = await st.SystemRepository.name();
const objectClassName = await st.Object.name;
const array = await st.Array.new_.transparent<Record<string, unknown>, GemStoneArrayProxy>(3);

try {
  await st.UserGlobals.at_put_("GemStoneJsBridgeDemo", 42);
  const storedValue = await st.UserGlobals.at_("GemStoneJsBridgeDemo");
  const arraySize = await array.size;

  console.log({
    repositoryName,
    objectClassName,
    storedValue,
    arrayOop: array.$oop.toString(),
    arraySize,
  });

  await session.abort().catch(() => undefined);
} finally {
  await array.$release();
}
