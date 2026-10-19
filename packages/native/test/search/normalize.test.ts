import assert from "node:assert/strict";
import test from "node:test";
import { compactField } from "../../src/search/normalize.js";

test("canonical ASCII sends no duplicate text/components/casing", () => {
  for (const key of ["path", "title"] as const)
    assert.deepEqual(compactField({ key, text: "src/FooBar.ts" }), {
      key,
      text: "src/FooBar.ts",
    });
});
test("Unicode overrides preserve independent JS contextual stem casing", () => {
  assert.deepEqual(compactField({ key: "path", text: "ΟΣ.txt" }), {
    key: "path",
    text: "ΟΣ.txt",
    lower: "οσ.txt",
    stemLower: "ος",
  });
  assert.equal(compactField({ key: "path", text: "İx" }).lower, "i\u0307x");
  assert.equal(
    compactField({ key: "title", text: "\ud800 İΣ" }).lower,
    "\ud800 i\u0307ς",
  );
});
