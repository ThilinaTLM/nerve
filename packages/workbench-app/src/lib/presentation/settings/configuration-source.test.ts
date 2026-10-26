import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sourceLabel,
  sourceChain,
  sameConfigurationSource,
} from "./configuration-source";
test("model and reasoning share one badge only for identical provenance, never hiding adjustment", () => {
  assert.equal(
    sameConfigurationSource({ source: "project" }, { source: "project" }),
    true,
  );
  assert.equal(
    sameConfigurationSource(
      { source: "recommendation", profile: "coding" },
      { source: "recommendation", profile: "planning" },
    ),
    false,
  );
  assert.equal(
    sameConfigurationSource(
      { source: "project" },
      { source: "project", adjusted: true },
    ),
    false,
  );
});
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
test("fitted reasoning is explicit in its label, while its layer stays in the expanded chain", () => {
  assert.equal(
    sourceLabel(
      { source: "recommendation", profile: "coding", adjusted: true },
      "Test model",
    ),
    "Adjusted for Test model",
  );
  assert.ok(
    sourceChain({
      source: "recommendation",
      profile: "coding",
      adjusted: true,
    }).includes("Profile recommendation"),
  );
  assert.deepEqual(
    sourceChain({ source: "requirement", profile: "coding" }, true),
    sourceChain({ source: "frozen" }),
  );
  assert.deepEqual(sourceChain({ source: "frozen" }), [
    "Frozen at creation",
    "Conversation choice",
    "Profile requirement",
  ]);
});
