import assert from "node:assert/strict";
import { test } from "node:test";
import { captureSystemPromptPreview } from "./system-prompt-preview";

type Pending = NonNullable<
  Parameters<typeof captureSystemPromptPreview>[0]["pending"]
>;
function draft(): Pending {
  return {
    id: "draft-one",
    projectId: "project-one",
    config: {
      model: { provider: "openai", modelId: "test" },
      reasoningLevel: "off",
      systemPrompt: null,
      instructions: "Unsent instructions",
      permissionRuleSetId: "default",
      agentProfile: "planning",
      workingDirectory: "/project",
    },
    overrides: {
      tools: { web_search: { enabled: false } },
    },
  };
}

test("preview before first input uses current draft config and overlays, not a stored conversation", () => {
  const pending = draft();
  const target = captureSystemPromptPreview({
    pending,
    conversation: { id: "partially-created", projectId: "project-one" },
  });
  assert.ok(target);
  assert.equal(target.sourceId, "pending:draft-one");
  assert.equal(target.projectId, "project-one");
  assert.deepEqual(target.params, {
    projectId: pending.projectId,
    config: {
      systemPrompt: null,
      instructions: "Unsent instructions",
      workingDirectory: "/project",
    },
    overrides: pending.overrides,
  });
});

test("each opening captures fresh settings without mutating an already captured preview", () => {
  const pending = draft();
  const first = captureSystemPromptPreview({ pending })!;
  pending.config.instructions = "Next request instructions";
  pending.config.agentProfile = "coding";
  pending.overrides = {
    ...pending.overrides,
    model: { provider: "openai", modelId: "changed" },
  };
  pending.overrides!.tools!.web_search = { enabled: true };
  const second = captureSystemPromptPreview({ pending })!;
  assert.ok(
    "config" in first.params &&
      "config" in second.params &&
      first.params.config &&
      second.params.config,
  );
  assert.equal(first.params.config.instructions, "Unsent instructions");
  assert.equal(first.params.overrides.model, undefined);
  assert.equal(second.params.config.instructions, "Next request instructions");
  assert.equal(second.params.overrides.model?.modelId, "changed");
  assert.deepEqual(first.params.overrides, draft().overrides);
});

test("saved conversations request fresh server preparation by ID, and absent targets are ignored", () => {
  assert.deepEqual(
    captureSystemPromptPreview({
      conversation: { id: "conv-one", projectId: "project-one" },
    }),
    {
      sourceId: "conv-one",
      projectId: "project-one",
      params: { conversationId: "conv-one" },
    },
  );
  assert.equal(captureSystemPromptPreview({}), undefined);
});

test("explicit draft profiles require a matching digest-bound target", () => {
  const pending = draft();
  pending.explicitAgentProfile = "planning";
  assert.throws(
    () => captureSystemPromptPreview({ pending }),
    /Profile unavailable/,
  );
  const targetProfile = { name: "planning", digest: "a".repeat(64) };
  const captured = captureSystemPromptPreview({ pending, targetProfile });
  assert.ok(captured && "agentProfile" in captured.params);
  assert.deepEqual(captured.params.agentProfile, targetProfile);
});
