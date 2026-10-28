import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import { editableCapabilityResets } from "./editable-resets";
test("reset capabilities preserves required fields, individual skill locks and non-capability choices", () => {
  const overrides = {
    model: { provider: "test", modelId: "chosen" },
    tools: { web_fetch: { enabled: false }, python_exec: { enabled: false } },
    skills: { file: { review: true }, nerve: { plan: true } },
  };
  const resolution = resolveAgentConfiguration({
    role: "lead",
    conversation: overrides,
    appliedProfile: {
      name: "planning",
      source: "builtin",
      sourceDigest: "a".repeat(64),
      instructions: "",
      recommendations: {},
      requirements: {
        tools: { web_fetch: { enabled: true } },
        skills: { file: { review: false } },
      },
    },
  });
  assert.deepEqual(editableCapabilityResets(overrides, resolution), [
    "/overrides/tools/python_exec/enabled",
    "/overrides/skills/nerve/plan",
  ]);
  assert.equal(overrides.tools.web_fetch.enabled, false);
  assert.equal(overrides.model.modelId, "chosen");
});
