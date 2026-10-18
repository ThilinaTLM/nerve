import assert from "node:assert/strict";
import test from "node:test";
import { validateUpdate } from "../../src/search/budget.js";
import type { SearchDocument } from "../../src/search/contracts.js";

const doc = (text: string): SearchDocument => ({
  id: "id:x",
  kind: "k",
  fields: [{ key: "name", text }],
});
test("document/field structure is rejected before field reads or captured graph allocation", () => {
  let read = false;
  const field = {
    key: "name" as const,
    get text(): string {
      read = true;
      throw new Error("expensive text read");
    },
  };
  const huge: SearchDocument = {
    id: "id:x",
    kind: "k",
    fields: Array(32).fill(field),
  };
  assert.throws(
    () => validateUpdate({ upsert: Array(12501).fill(huge), remove: [] }),
    /field budget/,
  );
  assert.equal(read, false);
  assert.throws(
    () => validateUpdate({ upsert: new Array(200001), remove: [] }),
    /count/,
  );
  assert.throws(
    () => validateUpdate({ upsert: [{ ...doc("x"), fields: [] }], remove: [] }),
    /1 to 32/,
  );
  assert.throws(
    () => validateUpdate({ upsert: [doc("")], remove: [] }),
    /nonempty field/,
  );
});
test("record budget counts derived path views and sparse casing spans", () => {
  assert.deepEqual(
    validateUpdate({
      upsert: [
        { id: "id:x", kind: "k", fields: [{ key: "path", text: "src/İ.ts" }] },
      ],
      remove: [],
    }),
    { units: 13, changes: 1, fields: 1, records: 7 },
  );
  const text = "a/".repeat(30000) + "z";
  assert.throws(
    () =>
      validateUpdate({
        upsert: Array.from({ length: 34 }, (_, i) => ({
          id: `id:${i}`,
          kind: "k",
          fields: [{ key: "path", text }],
        })),
        remove: [],
      }),
    /structural record budget/,
  );
});
test("per-document text is bounded independently of field count; optional empty fields are safe", () => {
  assert.throws(
    () =>
      validateUpdate({
        upsert: [
          {
            ...doc("x"),
            fields: [
              { key: "name", text: "x".repeat(40000) },
              { key: "description", text: "x".repeat(40000) },
            ],
          },
        ],
        remove: [],
      }),
    /document text/,
  );
  assert.equal(
    validateUpdate({
      upsert: [
        {
          ...doc("x"),
          fields: [
            { key: "name", text: "x" },
            { key: "description", text: "" },
          ],
        },
      ],
      remove: [],
    }).fields,
    2,
  );
});
