import assert from "node:assert/strict";
import test from "node:test";
import { userInputOptionSchema } from "../../src/domains/core/tool-call.js";

test("user input option labels accept up to 200 characters", () => {
  for (const length of [81, 200]) {
    const label = "a".repeat(length);
    assert.equal(userInputOptionSchema.parse({ label }).label, label);
  }
});

test("user input option labels reject empty and overlong values", () => {
  for (const length of [0, 201]) {
    assert.equal(
      userInputOptionSchema.safeParse({ label: "a".repeat(length) }).success,
      false,
    );
  }
});

test("user input options retain optional supporting descriptions", () => {
  const option = {
    label: "a".repeat(200),
    description: "Supporting detail for the option",
  };
  assert.deepEqual(userInputOptionSchema.parse(option), option);
});
