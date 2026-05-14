import assert from "node:assert/strict";
import test from "node:test";
import {
  OOP_FALSE,
  OOP_NIL,
  OOP_TRUE,
  OrderedCollection,
  Session,
  oopToSmallint,
  smallintToOop,
  type Oop,
} from "../src/index.ts";
import { MockGciRuntime } from "../src/testing/mock-runtime.ts";

test("OrderedCollection wraps live ordered sequence operations", async () => {
  const collections = new Map<Oop, Oop[]>();
  const arrays = new Map<Oop, Oop[]>();
  const collectionOop = 0x9000n as Oop;
  const executeSources: string[] = [];
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    execute(source) {
      executeSources.push(source);
      if (source.includes(collectionOop.toString()) && source.includes("removeAllSuchThat:")) {
        collections.set(collectionOop, []);
      }
      return OOP_NIL;
    },
    perform(receiver, selector, args) {
      const orderedClass = runtime.symbols.get("OrderedCollection");
      const arrayClass = runtime.symbols.get("Array");
      if (receiver === orderedClass && selector === "new") {
        collections.set(collectionOop, []);
        return collectionOop;
      }
      if (receiver === arrayClass && selector === "new:") {
        const array = runtime.allocate();
        arrays.set(array, Array(Number(oopToSmallint(args[0]))).fill(OOP_NIL));
        runtime.classByOop.set(array, arrayClass);
        return array;
      }
      if (arrays.has(receiver)) return performArray(arrays, receiver, selector, args);
      if (collections.has(receiver)) return performCollection(runtime, collections, arrays, receiver, selector, args);
      return OOP_NIL;
    },
  });

  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = await session.orderedCollection([1, 2]);

  assert.equal(collection.oop, collectionOop);
  assert.equal(await collection.size(), 2);
  assert.equal(await collection.isEmpty(), false);

  await collection.append(3);
  assert.equal(await collection.at(0), 1n);
  assert.equal(await collection.at(-1), 3n);
  assert.equal(await collection.at(99), null);
  assert.equal(await collection.first(), 1n);
  assert.equal(await collection.last(), 3n);
  assert.equal(await collection.includes(2), true);
  assert.equal(await collection.remove(2), true);
  assert.equal(await collection.remove(99), false);
  assert.deepEqual(await collection.values(), [1n, 3n]);

  const iterated = [];
  for await (const value of collection) iterated.push(value);
  assert.deepEqual(iterated, [1n, 3n]);

  const reversed = [];
  for await (const value of collection.reverseValues()) reversed.push(value);
  assert.deepEqual(reversed, [3n, 1n]);

  assert.equal(await collection.pop(), 3n);
  assert.equal(await collection.shift(), 1n);
  assert.equal(await collection.pop(), null);
  assert.equal(await collection.isEmpty(), true);

  const object = runtime.allocate();
  await collection.appendOop(object);
  assert.equal(await collection.containsOop(object), true);
  assert.deepEqual(await collection.valuesOop(), [object]);
  const handles = await collection.objects();
  assert.equal(handles[0].oop, object);
  await Promise.all(handles.map((handle) => handle.release()));

  await collection.clear();
  assert.equal(await collection.size(), 0);
  assert.match(executeSources.at(-1) ?? "", /removeAllSuchThat:/);

  const wrapped = session.wrapOrderedCollection(collectionOop);
  await wrapped.appendValue(4);
  assert.deepEqual(await wrapped.toArray(), [4n]);

  await session.logout();
});

test("OrderedCollection can wrap an existing OOP directly", async () => {
  const collections = new Map<Oop, Oop[]>([[0x9100n as Oop, [smallintToOop(7)]]]);
  const arrays = new Map<Oop, Oop[]>();
  let runtime: MockGciRuntime;
  runtime = new MockGciRuntime({
    perform(receiver, selector, args) {
      if (collections.has(receiver)) return performCollection(runtime, collections, arrays, receiver, selector, args);
      if (arrays.has(receiver)) return performArray(arrays, receiver, selector, args);
      return OOP_NIL;
    },
  });

  const session = await Session.connect({ username: "u", password: "p", runtime });
  const collection = new OrderedCollection(session, 0x9100n as Oop);

  assert.equal(await collection.size(), 1);
  assert.equal(await collection.firstValue(), 7n);

  await session.logout();
});

function performCollection(
  runtime: MockGciRuntime,
  collections: Map<Oop, Oop[]>,
  arrays: Map<Oop, Oop[]>,
  receiver: Oop,
  selector: string,
  args: Oop[],
): Oop {
  const values = collections.get(receiver);
  if (!values) return OOP_NIL;
  if (selector === "size") return smallintToOop(values.length);
  if (selector === "add:") {
    values.push(args[0]);
    return args[0];
  }
  if (selector === "addAll:") {
    values.push(...(arrays.get(args[0]) ?? []));
    return receiver;
  }
  if (selector === "includes:") return values.some((value) => value === args[0]) ? OOP_TRUE : OOP_FALSE;
  if (selector === "remove:") {
    const index = values.findIndex((value) => value === args[0]);
    if (index >= 0) values.splice(index, 1);
    return args[0];
  }
  if (selector === "at:") return values[Number(oopToSmallint(args[0])) - 1] ?? OOP_NIL;
  if (selector === "first") return values[0] ?? OOP_NIL;
  if (selector === "last") return values.at(-1) ?? OOP_NIL;
  if (selector === "removeLast") return values.pop() ?? OOP_NIL;
  if (selector === "removeFirst") return values.shift() ?? OOP_NIL;
  if (selector === "asArray") {
    const array = runtime.allocate();
    arrays.set(array, [...values]);
    const arrayClass = runtime.symbols.get("Array");
    if (arrayClass) runtime.classByOop.set(array, arrayClass);
    return array;
  }
  return OOP_NIL;
}

function performArray(arrays: Map<Oop, Oop[]>, receiver: Oop, selector: string, args: Oop[]): Oop {
  const values = arrays.get(receiver);
  if (!values) return OOP_NIL;
  if (selector === "size") return smallintToOop(values.length);
  if (selector === "at:") return values[Number(oopToSmallint(args[0])) - 1] ?? OOP_NIL;
  if (selector === "at:put:") {
    values[Number(oopToSmallint(args[0])) - 1] = args[1];
    return args[1];
  }
  return OOP_NIL;
}
