import assert from "node:assert/strict";
import { test } from "node:test";
import { agentProfileSchema } from "@nervekit/contracts/agent-profiles";
import { pendingProfilePreview } from "./pending-profile-preview";

const profile = agentProfileSchema.parse({
  name: "planning",
  label: "Planning",
  description: "Plan changes",
  enabled: true,
  usableBy: "lead",
  source: "builtin",
  instructions: "{{skill:planning}}",
  permission: { lock: "planning" },
  tools: {
    plan_present: {
      set: { enabled: true, settings: { approvalProfile: "coding" } },
    },
  },
});
const config = {
  agentProfile: "planning",
  model: { provider: "test", modelId: "model" },
  reasoningLevel: "off" as const,
  permissionRuleSetId: "autonomous",
  instructions: null,
  systemPrompt: null,
  workingDirectory: "/project",
};
test("pending Planning previews resulting permission, plan review and locks without mutating the draft", () => {
  const before = structuredClone(config);
  const result = pendingProfilePreview(
    profile,
    config,
    (_model, thinking) => thinking,
  )!;
  assert.equal(result.settings.permission, "planning");
  assert.equal(result.applied.locked.permission, "planning");
  assert.equal(result.settings.tools.plan_present?.enabled, true);
  assert.equal(result.applied.locked.tools?.plan_present, undefined);
  assert.equal(result.applied.instructions, "{{skill:planning}}");
  assert.deepEqual(config, before);
});
test("an unloaded catalog does not fabricate a preview", () => {
  assert.equal(
    pendingProfilePreview(undefined, config, (_model, thinking) => thinking),
    undefined,
  );
});
