import assert from "node:assert/strict";
import { test } from "node:test";
import { patchChanged, sameValue } from "./summary-patch";

test("patchChanged writes only differing fields and reports no-ops", () => {
  const references = [{ id: "r" }];
  const target: Record<string, unknown> = { a: 1, references, extra: true };
  const writes: string[] = [];
  const observed = new Proxy(target, {
    set(object, key, value) {
      writes.push(String(key));
      object[key as string] = value;
      return true;
    },
  });
  assert.equal(
    patchChanged(observed, { a: 1, references: [{ id: "r" }] }, false),
    false,
  );
  assert.deepEqual(writes, []);
  assert.equal(target.references, references);
  assert.equal(patchChanged(observed, { a: 2 }, false), true);
  assert.deepEqual(writes, ["a"]);
  assert.equal(target.extra, true);
});

test("patchChanged with removeMissing deletes absent fields", () => {
  const target: Record<string, unknown> = { a: 1, model: { id: "m" } };
  assert.equal(patchChanged(target, { a: 1 }, true), true);
  assert.deepEqual(target, { a: 1 });
});

test("sameValue compares JSON data structurally", () => {
  assert.equal(
    sameValue({ a: [1, { b: null }] }, { a: [1, { b: null }] }),
    true,
  );
  assert.equal(sameValue({ a: [1] }, { a: { 0: 1 } }), false);
  assert.equal(sameValue({ a: 1 }, { a: 1, b: undefined }), false);
});
