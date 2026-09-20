import assert from "node:assert/strict";
import { test } from "node:test";
import { dimensionError, pairErrors } from "./optimize.mjs";

test("accepts complete light and dark pairs", () => {
  assert.deepEqual(
    pairErrors("desktop", [
      "conversation-light",
      "conversation-dark",
      "git-light",
      "git-dark",
    ]),
    [],
  );
});

test("rejects a scene missing one colour mode", () => {
  const errors = pairErrors("desktop", ["conversation-light", "git-dark"]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /conversation: incomplete pair \(missing dark\)/);
  assert.match(errors[1], /git: incomplete pair \(missing light\)/);
});

test("accepts the expected source dimensions", () => {
  assert.equal(
    dimensionError("desktop", "git-light", { width: 2880, height: 1800 }),
    undefined,
  );
  assert.equal(
    dimensionError("mobile", "conversation-dark", {
      width: 1170,
      height: 2532,
    }),
    undefined,
  );
});

test("rejects unexpected dimensions and unknown groups", () => {
  assert.match(
    dimensionError("desktop", "git-light", { width: 1440, height: 900 }),
    /expected 2880x1800, got 1440x900/,
  );
  assert.match(
    dimensionError("tablet", "git-light", { width: 2880, height: 1800 }),
    /unknown capture group/,
  );
});
