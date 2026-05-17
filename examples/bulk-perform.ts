import { Session, smallintToOop, type TypedOop } from "../src/index.ts";

await using session = await Session.connect(Session.configFromEnv());

try {
  const numbers = [smallintToOop(7), smallintToOop(8), smallintToOop(9)];

  const rawOops = await session.bulkPerformOop(numbers, "yourself");
  const values = await session.bulkPerformValueWith(numbers, "+", 1);

  const objectClass = session.classRef("Object");
  const objectClassOop = await objectClass.oop();
  const objects: TypedOop[] = await session.bulkPerformObjects([objectClassOop, objectClassOop], "new");

  const mixedValues = await session.performCallsValueWith([
    [smallintToOop(3), "+", [4]],
    { receiver: smallintToOop(10), selector: "-", args: [2] },
  ]);

  console.log({
    rawOops: rawOops.map(String),
    values,
    objectOops: objects.map((object) => object.oop.toString()),
    mixedValues,
  });

  await Promise.all(objects.map((object) => object.release()));
} finally {
  await session.abort().catch(() => undefined);
}
