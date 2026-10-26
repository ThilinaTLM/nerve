import assert from "node:assert/strict";
import { test } from "node:test";
import {
  profileChangeSummary,
  profileChangeValue,
} from "./profile-transition-diff";
test("value-equal policy changes visibly explain the controlling-source transition", () => {
  assert.equal(
    profileChangeSummary({
      pointer: "/reasoningLevel",
      before: "high",
      after: "high",
      beforeSource: { source: "recommendation", profile: "planning" },
      afterSource: { source: "requirement", profile: "planning" },
    }),
    "high · Recommended · planning → Required · planning",
  );
});
test("instruction changes and removals are readable without inventing unchanged settings", () => {
  assert.equal(
    profileChangeSummary({
      pointer: "/appliedProfile/instructions",
      before: "Plan first",
      after: "Implement",
    }),
    "Plan first → Implement",
  );
  assert.equal(profileChangeValue(null), "Use settings");
  assert.equal(profileChangeValue(""), "(empty)");
});
