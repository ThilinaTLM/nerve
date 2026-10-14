import assert from "node:assert/strict";
import test from "node:test";
import {
  subagentProfilesPreviewParamsSchema,
  subagentProfilesReplaceConversationParamsSchema,
} from "../../src/domains/subagents/index.js";

const document = {
  schemaVersion: 1,
  profiles: { developer: { enabled: false } },
};
const lead = {
  model: { provider: "provider", modelId: "model" },
  reasoningLevel: "high",
};

test("draft preview validates sparse documents and accepts only narrow lead context", () => {
  const input = { projectId: "proj_one", document, lead };
  assert.deepEqual(subagentProfilesPreviewParamsSchema.parse(input), input);
  for (const invalid of [
    { ...input, projectId: "other" },
    { ...input, conversationId: "conv_one" },
    { ...input, lead: { ...lead, workingDirectory: "/tmp" } },
    { ...input, lead: { ...lead, reasoningLevel: "invalid" } },
    { ...input, lead: { reasoningLevel: "high" } },
    {
      ...input,
      document: {
        schemaVersion: 1,
        profiles: { developer: { model: "invalid" } },
      },
    },
  ])
    assert.equal(
      subagentProfilesPreviewParamsSchema.safeParse(invalid).success,
      false,
    );
});

test("conversation replacement requires ownership IDs and an explicit nullable digest", () => {
  const input = {
    projectId: "proj_one",
    conversationId: "conv_one",
    document,
    expectedDigest: null,
  };
  assert.deepEqual(
    subagentProfilesReplaceConversationParamsSchema.parse(input),
    input,
  );
  assert.equal(
    subagentProfilesReplaceConversationParamsSchema.safeParse({
      ...input,
      expectedDigest: "digest",
    }).success,
    true,
  );
  for (const invalid of [
    { ...input, expectedDigest: undefined },
    { ...input, expectedDigest: "" },
    { ...input, projectId: undefined },
    { ...input, conversationId: undefined },
    { ...input, scope: "project" },
    { ...input, document: { schemaVersion: 2, profiles: {} } },
  ])
    assert.equal(
      subagentProfilesReplaceConversationParamsSchema.safeParse(invalid)
        .success,
      false,
    );
});
