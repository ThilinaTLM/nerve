import assert from "node:assert/strict";
import test from "node:test";
import {
  agentProfilesPreviewParamsSchema,
  agentProfilesUpdateParamsSchema,
  agentProfilesResetParamsSchema,
  agentProfilesTrustParamsSchema,
} from "../../src/domains/agent-profiles/index.js";

test("draft preview accepts in-memory named templates, not persisted aggregate documents", () => {
  const input = {
    projectId: "proj_one",
    profiles: [
      {
        name: "reader",
        description: "Read",
        usableBy: "subagent",
        instructions: "Read",
      },
    ],
    lead: {
      model: { provider: "test", modelId: "test" },
      reasoningLevel: "off",
    },
  };
  assert.equal(agentProfilesPreviewParamsSchema.safeParse(input).success, true);
  assert.equal(
    agentProfilesPreviewParamsSchema.safeParse({
      ...input,
      document: { schemaVersion: 1, profiles: {} },
    }).success,
    false,
  );
});

test("per-file mutations/trust require project identity and profile name", () => {
  assert.equal(
    agentProfilesUpdateParamsSchema.safeParse({
      scope: "project",
      name: "reader",
      patch: { instructions: "New" },
    }).success,
    false,
  );
  assert.equal(
    agentProfilesUpdateParamsSchema.safeParse({
      scope: "project",
      projectId: "proj_one",
      name: "reader",
      expectedDigest: null,
      patch: { permission: null },
    }).success,
    true,
  );
  assert.equal(
    agentProfilesResetParamsSchema.safeParse({
      scope: "user",
      name: "reader",
      expectedDigest: "file-digest",
    }).success,
    true,
  );
  assert.equal(
    agentProfilesTrustParamsSchema.safeParse({
      projectId: "proj_one",
      name: "reader",
      digest: "file-digest",
    }).success,
    true,
  );
  assert.equal(
    agentProfilesTrustParamsSchema.safeParse({
      projectId: "proj_one",
      digest: "aggregate-digest",
    }).success,
    false,
  );
  assert.equal(
    agentProfilesUpdateParamsSchema.safeParse({
      scope: "conversation",
      conversationId: "conv_one",
      name: "reader",
      patch: { instructions: "New" },
    }).success,
    false,
  );
});
