import assert from "node:assert/strict";
import { test } from "node:test";
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
    agentProfileOverrides: {
      schemaVersion: 1,
      profiles: { explore: { enabled: false } },
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
  const profileInputs: Array<{
    expectedDigest: string | null;
    document: NonNullable<Pending["agentProfileOverrides"]>;
  }> = [];
  const snapshot = {
    conversation: { id: "conv_one" },
    config: { agentProfile: "coding" },
    marker: "snapshot",
  };
  const create: Parameters<
    typeof submitPendingConversation<typeof snapshot>
  >[2]["create"] = async () => {
    calls.push("create");
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
    saveProfiles: async (input: (typeof profileInputs)[number]) => {
      calls.push("profiles");
      profileInputs.push(input);
      return { digest: "saved-digest" };
    },
    submit: async (id: string, text: string) => {
      calls.push(`input:${id}:${text}`);
    },
  };
  return { pending, calls, profileInputs, snapshot, dependencies };
}

test("first input starts only after capability and profile configuration is saved", async () => {
  const { pending, calls, profileInputs, snapshot, dependencies } = setup();
  const result = await submitPendingConversation(
    pending,
    "hello",
    dependencies,
  );
  assert.equal(result, snapshot);
  assert.deepEqual(calls, [
    "create",
    "capabilities",
    "profiles",
    "input:conv_one:hello",
  ]);
  assert.equal(pending.createdConversationId, "conv_one");
  assert.equal(pending.agentProfileDigest, "saved-digest");
  assert.equal(profileInputs[0]?.expectedDigest, null);
  assert.deepEqual(profileInputs[0]?.document, pending.agentProfileOverrides);
});

test("an unedited draft inherits profiles without creating a profile file", async () => {
  const { pending, calls, dependencies } = setup();
  delete pending.agentProfileOverrides;
  await submitPendingConversation(pending, "hello", dependencies);
  assert.deepEqual(calls, ["create", "capabilities", "input:conv_one:hello"]);
  assert.equal(pending.agentProfileDigest, undefined);
});

test("a failed capability save stops profile persistence and input submission", async () => {
  const { pending, calls, dependencies } = setup();
  dependencies.saveCapabilities = async () => {
    calls.push("capabilities-failed");
    throw new Error("capability save failed");
  };
  await assert.rejects(
    submitPendingConversation(pending, "hello", dependencies),
    /capability save failed/,
  );
  assert.deepEqual(calls, ["create", "capabilities-failed"]);
  assert.equal(pending.createdConversationId, "conv_one");
  assert.equal(pending.agentProfileDigest, undefined);
});

test("a failed profile save retains the draft and created conversation, and never submits input", async () => {
  const { pending, calls, dependencies } = setup();
  const original = pending.agentProfileOverrides;
  dependencies.saveProfiles = async () => {
    calls.push("profiles-failed");
    throw new Error("profile save failed");
  };
  await assert.rejects(
    submitPendingConversation(pending, "hello", dependencies),
    /profile save failed/,
  );
  assert.deepEqual(calls, ["create", "capabilities", "profiles-failed"]);
  assert.equal(pending.createdConversationId, "conv_one");
  assert.equal(pending.agentProfileDigest, undefined);
  assert.equal(pending.agentProfileOverrides, original);
  dependencies.saveProfiles = async () => {
    calls.push("profiles-retry");
    return { digest: "saved-digest" };
  };
  await submitPendingConversation(pending, "hello", dependencies);
  assert.deepEqual(calls.slice(3), [
    "configure",
    "get:conv_one",
    "capabilities",
    "profiles-retry",
    "input:conv_one:hello",
  ]);
});

test("input failure retries with the saved digest instead of creating another conversation", async () => {
  const { pending, calls, profileInputs, dependencies } = setup();
  const successfulSubmit = dependencies.submit;
  dependencies.submit = async () => {
    calls.push("input-failed");
    throw new Error("submit failed");
  };
  await assert.rejects(
    submitPendingConversation(pending, "hello", dependencies),
    /submit failed/,
  );
  assert.equal(pending.agentProfileDigest, "saved-digest");
  dependencies.submit = successfulSubmit;
  await submitPendingConversation(pending, "hello", dependencies);
  assert.deepEqual(calls.slice(4), [
    "configure",
    "get:conv_one",
    "capabilities",
    "profiles",
    "input:conv_one:hello",
  ]);
  assert.deepEqual(
    profileInputs.map((input) => input.expectedDigest),
    [null, "saved-digest"],
  );
});

test("external profile conflicts stop retries without accepting the new digest", async () => {
  const { pending, calls, dependencies } = setup();
  pending.createdConversationId = "conv_one";
  pending.agentProfileDigest = "previous-digest";
  dependencies.saveProfiles = async (input) => {
    assert.equal(input.expectedDigest, "previous-digest");
    calls.push("conflict");
    throw new Error("Document changed; reload before saving");
  };
  await assert.rejects(
    submitPendingConversation(pending, "hello", dependencies),
    /Document changed/,
  );
  assert.deepEqual(calls, [
    "configure",
    "get:conv_one",
    "capabilities",
    "conflict",
  ]);
  assert.equal(pending.agentProfileDigest, "previous-digest");
  assert.equal(pending.agentProfileOverrides?.profiles.explore?.enabled, false);
});

test("pending configuration is snapshotted before asynchronous creation", async () => {
  const { pending, profileInputs, dependencies } = setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const create = dependencies.create;
  dependencies.create = async (input) => {
    await gate;
    return create(input);
  };
  const submission = submitPendingConversation(pending, "hello", dependencies);
  pending.agentProfileOverrides!.profiles.explore!.enabled = true;
  release();
  await submission;
  assert.equal(profileInputs[0]?.document.profiles.explore?.enabled, false);
});

test("retry sends the edited draft configuration rather than the previously created configuration", async () => {
  const { pending, calls, dependencies } = setup();
  pending.createdConversationId = "conv_one";
  pending.config.instructions = "Use these instructions for the next request";
  pending.config.agentProfile = "planning";
  pending.explicitAgentProfile = "planning";
  const configurations: Omit<Pending["config"], "agentProfile">[] = [];
  dependencies.configure = async (id, config) => {
    assert.equal(id, "conv_one");
    calls.push("configure");
    configurations.push(config);
  };
  await submitPendingConversation(pending, "hello", dependencies);
  assert.deepEqual(configurations, [withoutProfile(pending.config)]);
  assert.deepEqual(calls, [
    "configure",
    "get:conv_one",
    "profile:conv_one:planning",
    "get:conv_one",
    "capabilities",
    "profiles",
    "input:conv_one:hello",
  ]);
});

test("creation leaves the default profile to the server and honors only explicit choices", async () => {
  for (const explicit of [undefined, "planning"]) {
    const { pending, dependencies, calls, snapshot } = setup();
    pending.explicitAgentProfile = explicit;
    snapshot.config.agentProfile = explicit ?? "project-default";
    let sentProfile: string | undefined;
    dependencies.create = async (
      input: Parameters<
        Parameters<typeof submitPendingConversation>[2]["create"]
      >[0],
    ) => {
      sentProfile = input.config.agentProfile;
      return snapshot;
    };
    await submitPendingConversation(pending, "hello", dependencies);
    assert.equal(sentProfile, explicit);
    assert.ok(!calls.some((call) => call.startsWith("profile:")));
  }
});
