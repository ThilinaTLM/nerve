import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceLabel } from "./configuration-source";
test("source labels retain the controlling profile and never invent an unavailable source", () => {
  assert.equal(
    sourceLabel({ source: "requirement", profile: "planning" }),
    "Required · planning",
  );
  assert.equal(
    sourceLabel({ source: "recommendation", profile: "coding" }),
    "Recommended · coding",
  );
  assert.equal(sourceLabel(), "Unavailable");
});
test("fitted reasoning is explicit in its label", () => {
  assert.equal(
    sourceLabel(
      { source: "recommendation", profile: "coding", adjusted: true },
      "Test model",
    ),
    "Adjusted for Test model",
  );
});
