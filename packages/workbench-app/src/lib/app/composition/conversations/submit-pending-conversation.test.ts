import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCapabilityOverrides } from "@nervekit/contracts/capabilities";
import type { PendingConversationState } from "$lib/application/workspace/pending-conversations.svelte";
import { submitPendingConversation } from "./submit-pending-conversation";

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
function withoutProfile(config: Pending["config"]) {
  const patch: Partial<Pending["config"]> = { ...config };
  delete patch.agentProfile;
  return patch;
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
    created.push(input.capabilityOverrides);
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
      config: Omit<Pending["config"], "agentProfile">,
    ) => {
      assert.equal(id, "conv_one");
      assert.deepEqual(config, withoutProfile(pending.config));
      calls.push("configure");
    },
    setAgentProfile: async (id: string, profile: string) => {
      calls.push(`profile:${id}:${profile}`);
    },
    saveCapabilities: async () => {
      calls.push("capabilities");
    },
    submit: async (id: string, text: string) => {
      calls.push(`input:${id}:${text}`);
    },
  };
  return { pending, calls, created, snapshot, dependencies };
}

test("creation carries the capability choices and no post-create save follows", async () => {
  const { pending, calls, created, snapshot, dependencies } = setup();
  pending.capabilityOverrides = {
    ...emptyCapabilityOverrides(),
    tools: { web_search: { enabled: false } },
  };
  const result = await submitPendingConversation(
    pending,
    "hello",
    dependencies,
  );
  assert.equal(result, snapshot);
  // Creation carries the capability choices; there is no post-create save.
  assert.deepEqual(calls, ["create", "input:conv_one:hello"]);
  assert.deepEqual(created, [pending.capabilityOverrides]);
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
    "capabilities",
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
    "capabilities",
    "input:conv_one:hello",
  ]);
});
