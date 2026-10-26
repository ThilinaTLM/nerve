import assert from "node:assert/strict";
import { test } from "node:test";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";
import { submitPendingConversation } from "./submit-pending-conversation";
import {
  applySettingsMutation,
  type LeadSettingsOverrides,
} from "@nervekit/contracts/agent-configuration";
import {
  mutateDraftSettings,
  replacementSettingsMutation,
} from "$lib/application/agent-configuration/override-view";

type Pending = Parameters<typeof submitPendingConversation>[0];
function draft(): Pending {
  return {
    projectId: "proj_one",
    title: "New Conversation",
    config: {
      model: { provider: "openai", modelId: "test" },
      reasoningLevel: "off",
      systemPrompt: null,
      instructions: null,
      permissionRuleSetId: "default",
      agentProfile: "coding",
      workingDirectory: "/project",
    },
  } satisfies Pick<PendingConversationState, keyof Pending>;
}
function context(config: Pending["config"]) {
  const { systemPrompt, instructions, workingDirectory } = config;
  return { systemPrompt, instructions, workingDirectory };
}
function setup(pending = draft()) {
  const calls: string[] = [];
  const created: unknown[] = [];
  const snapshot = {
    conversation: { id: "conv_one" },
    config: { agentProfile: "coding" },
    marker: "snapshot",
  };
  const create: Parameters<
    typeof submitPendingConversation<typeof snapshot>
  >[2]["create"] = async (input) => {
    calls.push("create");
    created.push(input.overrides);
    return snapshot;
  };
  const dependencies = {
    create,
    getSnapshot: async (id: string) => {
      calls.push(`get:${id}`);
      return snapshot;
    },
    configure: async (
      id: string,
      config: Partial<
        Pick<
          Pending["config"],
          "systemPrompt" | "instructions" | "workingDirectory"
        >
      >,
    ) => {
      assert.equal(id, "conv_one");
      assert.deepEqual(config, context(pending.config));
      calls.push("configure");
    },
    setAgentProfile: async (id: string, profile: string) => {
      calls.push(`profile:${id}:${profile}`);
    },
    resolveProfile: async (_projectId: string, name: string) => ({
      name,
      digest: "a".repeat(64),
    }),
    saveOverrides: async () => {
      calls.push("overrides");
    },
    submit: async (id: string, text: string) => {
      calls.push(`input:${id}:${text}`);
    },
  };
  return { pending, calls, created, snapshot, dependencies };
}

test("retry replaces a previously created override when the draft returns to inheritance", async () => {
  const { pending, dependencies } = setup();
  const baseline = { model: { provider: "openai", modelId: "A" } };
  pending.inheritedSettings = baseline;
  pending.overrides = { model: { provider: "openai", modelId: "B" } };
  let persisted: LeadSettingsOverrides = {};
  let failInput = true;
  const retryDependencies = {
    ...dependencies,
    create: async (input: Parameters<typeof dependencies.create>[0]) => {
      persisted = input.overrides ?? {};
      return dependencies.create(input);
    },
    saveOverrides: async (_id: string, desired: LeadSettingsOverrides) => {
      persisted = applySettingsMutation(persisted, {
        expectedRevision: 1,
        expectedDigest: "a".repeat(64),
        ...replacementSettingsMutation(persisted, desired),
      });
    },
    submit: async () => {
      if (failInput) throw new Error("first input failed");
    },
  };
  await assert.rejects(
    submitPendingConversation(pending, "hello", retryDependencies),
    /first input failed/,
  );
  assert.equal(pending.createdConversationId, "conv_one");
  assert.equal(persisted.model?.modelId, "B");
  pending.overrides = mutateDraftSettings(
    pending.overrides,
    baseline,
    [],
    baseline,
  );
  assert.deepEqual(pending.overrides, {});
  failInput = false;
  await submitPendingConversation(pending, "hello", retryDependencies);
  assert.deepEqual(persisted, {});
});

test("creation carries the sparse choices and no post-create save follows", async () => {
  const { pending, calls, created, snapshot, dependencies } = setup();
  pending.overrides = {
    tools: { web_search: { enabled: false } },
  };
  const result = await submitPendingConversation(
    pending,
    "hello",
    dependencies,
  );
  assert.equal(result, snapshot);
  // Creation carries the sparse choices; there is no post-create save.
  assert.deepEqual(calls, ["create", "input:conv_one:hello"]);
  assert.deepEqual(created, [pending.overrides]);
  assert.equal(pending.createdConversationId, "conv_one");
});

test("input failure retries on the created conversation with the edited draft", async () => {
  const { pending, calls, dependencies } = setup();
  const successfulSubmit = dependencies.submit;
  dependencies.submit = async () => {
    calls.push("input-failed");
    throw new Error("submit failed");
  };
  await assert.rejects(
    submitPendingConversation(pending, "hello", dependencies),
    /submit failed/,
  );
  dependencies.submit = successfulSubmit;
  pending.config.instructions = "Use these instructions";
  await submitPendingConversation(pending, "hello", dependencies);
  assert.deepEqual(calls.slice(2), [
    "configure",
    "get:conv_one",
    "overrides",
    "input:conv_one:hello",
  ]);
});

test("an explicit profile change on retry switches through setAgentProfile", async () => {
  const { pending, calls, dependencies } = setup();
  pending.createdConversationId = "conv_one";
  pending.explicitAgentProfile = "planning";
  await submitPendingConversation(pending, "hello", dependencies);
  assert.deepEqual(calls, [
    "configure",
    "get:conv_one",
    "profile:conv_one:planning",
    "get:conv_one",
    "overrides",
    "input:conv_one:hello",
  ]);
});

test("creation omits inherited agent values and binds explicit profiles to catalog bytes", async () => {
  const { pending, dependencies } = setup();
  pending.explicitAgentProfile = "planning";
  dependencies.create = async (input) => {
    assert.deepEqual(input.config, context(pending.config));
    assert.deepEqual(input.overrides, {});
    assert.deepEqual(input.agentProfile, {
      name: "planning",
      digest: "a".repeat(64),
    });
    return {
      conversation: { id: "conv_one" },
      config: { agentProfile: "planning" },
      marker: "snapshot",
    };
  };
  await submitPendingConversation(pending, "hello", dependencies);
});

test("creation strips redundant draft choices against its authoritative lower layer", async () => {
  const { pending, created, dependencies } = setup();
  pending.inheritedSettings = {
    model: { provider: "openai", modelId: "inherited" },
    reasoningLevel: "off",
    tools: { web_search: { enabled: true } },
  };
  pending.overrides = {
    ...pending.inheritedSettings,
    permissionRuleSetId: "read_only",
  };
  await submitPendingConversation(pending, "hello", dependencies);
  assert.deepEqual(created, [{ permissionRuleSetId: "read_only" }]);
  // Submission/view normalization is not an implicit persisted save.
  assert.equal(pending.overrides.reasoningLevel, "off");
});
