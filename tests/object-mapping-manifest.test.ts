import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("object mapping manifest example tracks the published schema contract", () => {
  const schema = JSON.parse(readFileSync(
    new URL("../schemas/object-mapping-manifest.schema.json", import.meta.url),
    "utf8",
  ));
  const manifest = JSON.parse(readFileSync(
    new URL("../examples/object-mapping.manifest.json", import.meta.url),
    "utf8",
  ));

  assert.equal(schema.title, "gemstone-js object mapping manifest");
  assert.equal(schema.properties.classes.items.$ref, "#/$defs/classSpec");
  assert.deepEqual(schema.$defs.returnKind.enum, ["value", "oop", "object", "dict"]);
  assert.deepEqual(schema.$defs.repositoryMethodSpec.properties.returnKind.enum, [
    "ref",
    "value",
    "oop",
    "object",
    "dict",
  ]);

  assert.equal(manifest.$schema, "../schemas/object-mapping-manifest.schema.json");
  assert.equal(manifest.classes[0].name, "Booking");
  assert.equal(manifest.classes[0].refName, "BookingRef");
  assert.equal(manifest.classes[0].repository.name, "BookingRepository");
  assert.equal(manifest.classes[0].repository.methods[0].returnKind, "ref");
});
