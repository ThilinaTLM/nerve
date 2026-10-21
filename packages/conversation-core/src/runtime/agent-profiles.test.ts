import { emptyCapabilityOverrides } from "@nervekit/contracts/capabilities";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConversationCore } from "../core.js";
import { ModelTurn } from "./model-turn.js";
import type { PiModel } from "../ports.js";
import { options, createConversation } from "./lifecycle-test-helpers.js";

void test("profile switching awaits overlay persistence and publishes the saved config", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerve-profile-"));
  const opts = options(
    directory,
    join(directory, "core.sqlite"),
    {
      async resolve() {
        throw new Error("No model expected");
      },
    },
    {
      async execute() {
        throw new Error("No host tool expected");
      },
      isReplaySafe: () => false,
    },
  );
  const writes: unknown[] = [];
  opts.agentProfiles.switchProfile = async ({ profile, config }) => {
    assert.equal(config.agentProfile, "coding");
    assert.equal(profile, undefined);
    return {
      config: { agentProfile: "implementation", reasoningLevel: "high" },
      compaction: null,
      capabilityOverrides: emptyCapabilityOverrides(),
    };
  };
  opts.persistAgentProfileOverrides = async (id, patch) => {
    writes.push({ id, patch });
  };
  const core = new ConversationCore(opts);
  try {
    await createConversation(core, "conv_profile");
    const changes: string[] = [];
    core.subscribe((change) => {
      if (change.kind === "config_changed") {
        assert.equal(writes.length, 1);
        changes.push(change.config.agentProfile);
      }
    });
    const config = await core.setAgentProfile("conv_profile");
    assert.equal(config.agentProfile, "implementation");
    assert.equal(config.reasoningLevel, "high");
    assert.deepEqual(changes, ["implementation"]);
    assert.equal(
      core.getSnapshot("conv_profile").config.agentProfile,
      "implementation",
    );
    opts.agentProfiles.switchProfile = async () => ({
      config: { agentProfile: "planning" },
      compaction: null,
    });
    opts.persistAgentProfileOverrides = async () => {
      throw new Error("Overlay write failed");
    };
    await assert.rejects(
      core.setAgentProfile("conv_profile", "planning"),
      /Overlay write failed/,
    );
    assert.equal(
      core.getSnapshot("conv_profile").config.agentProfile,
      "implementation",
    );
    assert.deepEqual(changes, ["implementation"]);
    assert.deepEqual(writes, [
      {
        id: "conv_profile",
        patch: {
          compaction: null,
          capabilityOverrides: emptyCapabilityOverrides(),
        },
      },
    ]);
  } finally {
    await core.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test("turn locks overlay stored scalars without mutation and resolve once per request", async () => {
  const config = {
    conversationId: "conv_profile",
    agentProfile: "planning",
    model: { provider: "test", modelId: "stored" },
    reasoningLevel: "off" as const,
    permissionRuleSetId: "baseline",
    workingDirectory: "/tmp",
    systemPrompt: null,
    instructions: null,
  };
  const stored = structuredClone(config);
  let resolutions = 0;
  const turn = new ModelTurn(
    {
      async resolve(selection) {
        assert.equal(selection.modelId, "locked");
        return { model: { id: "locked" } as PiModel };
      },
    },
    {
      async prepare(input) {
        assert.equal(input.config.permissionRuleSetId, "planning");
        assert.equal(input.config.reasoningLevel, "high");
        return { systemPrompt: "Prompt", tools: [] };
      },
    },
    () => [],
    () => {},
    undefined,
    {
      async resolveLockedScalars() {
        resolutions++;
        return {
          model: { provider: "test", modelId: "locked" },
          reasoningLevel: "high",
          permissionRuleSetId: "planning",
        };
      },
      async switchProfile() {
        throw new Error("No switch expected");
      },
    },
  );
  const prepared = await turn.prepareRequest({
    conversation: {
      id: "conv_profile",
      projectId: "project",
      parentConversationId: null,
    } as Parameters<ModelTurn["run"]>[0]["conversation"],
    config,
    projectDir: "/tmp",
    path: [],
    turnId: "turn",
    signal: new AbortController().signal,
  });
  assert.equal(prepared.reasoning, "high");
  assert.equal(resolutions, 1);
  assert.deepEqual(config, stored);
});
