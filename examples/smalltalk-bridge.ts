import { Session, smalltalkBridge } from "gemstone-js";

await using session = await Session.connect(Session.configFromEnv());

const st = smalltalkBridge(session);

const repositoryName = await st.SystemRepository.name();
const objectClassName = await st.Object.name;
const array = await st.Array.new_.object<unknown[]>(3);

try {
  await st.UserGlobals.at_put_("GemStoneJsBridgeDemo", 42);
  const storedValue = await st.UserGlobals.at_("GemStoneJsBridgeDemo");
  const arraySize = await array.send("size");

  console.log({
    repositoryName,
    objectClassName,
    storedValue,
    arrayOop: array.oop.toString(),
    arraySize,
  });

  await session.abort().catch(() => undefined);
} finally {
  await array.release();
}
