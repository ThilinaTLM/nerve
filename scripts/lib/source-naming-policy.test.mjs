import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERIC_SOURCE_NAME_EXCEPTIONS,
  sourceNamingPolicyViolation,
} from "./source-naming-policy.mjs";

test("reviewed cohesive generic source names are explicit", () => {
  for (const file of GENERIC_SOURCE_NAME_EXCEPTIONS)
    assert.equal(sourceNamingPolicyViolation(file), undefined, file);
});

test("unreviewed generic production source names fail", () => {
  assert.equal(
    sourceNamingPolicyViolation("packages/example/src/domain/helpers.ts"),
    "generic production source name is not in the reviewed cohesive-exception inventory",
  );
  assert.equal(
    sourceNamingPolicyViolation(
      "packages/example/src/domain/conversation-policy.ts",
    ),
    undefined,
  );
});

test("test support is outside the production source inventory", () => {
  assert.equal(
    sourceNamingPolicyViolation("packages/example/test/support/helpers.ts"),
    undefined,
  );
});
