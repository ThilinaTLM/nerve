import type { CapabilityOverridesDocument } from "@nervekit/contracts/capabilities";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyAgentProfileTemplate,
  type AgentProfileDraft,
  type AppliedAgentProfile,
} from "@nervekit/contracts/agent-profiles";
import { defaultSettings } from "@nervekit/contracts/settings";
import { ConversationCore } from "../core.js";
import { ModelTurn } from "./model-turn.js";
import type {
  AgentProfileApplication,
  AgentProfilePort,
  PiModel,
} from "../ports.js";
import { options, createConversation } from "./lifecycle-test-helpers.js";

void test("application materializes locks, rejects configure and use-settings keeps their current values", async () => {
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
  const snapshots = new Map<string, AppliedAgentProfile>();
  const templates: Record<string, AgentProfileDraft> = {
    coding: {
      name: "coding",
      description: "Keep settings",
      usableBy: "lead",
      instructions: "Summary",
    },
    frozen: {
      name: "frozen",
      description: "Lock values",
      usableBy: "lead",
      instructions: "Original instructions",
      model: { lock: { provider: "test", modelId: "locked" } },
      thinking: { lock: "high" },
      permission: { lock: "planning" },
    },
  };
  const writes: string[] = [];
  opts.agentProfiles = {
    async applyProfile({ config, profile }) {
      const name = profile ?? "coding";
      const { settings, applied } = applyAgentProfileTemplate(
        templates[name]!,
        {
          model: config.model,
          thinking: config.reasoningLevel,
          permission: config.permissionRuleSetId,
          compaction: defaultSettings.compaction,
          tools: {},
          skills: "none",
        },
        { clampThinking: (_model, thinking) => thinking },
      );
      return {
        config: {
          agentProfile: name,
          model: settings.model,
          reasoningLevel: settings.thinking,
          permissionRuleSetId: settings.permission,
        },
        applied,
      };
    },
    async persistApplication(id, application) {
      snapshots.set(id, structuredClone(application.applied));
      writes.push(application.applied.name);
    },
    getAppliedProfile: (id) => snapshots.get(id) ?? null,
  };
  const core = new ConversationCore(opts);
  try {
    await createConversation(core, "conv_setup");
    writes.length = 0;
    const [first, second] = await Promise.all([
      core.createConversation({ id: "conv_profile", projectId: "proj_test" }),
      core.createConversation({ id: "conv_profile", projectId: "proj_test" }),
    ]);
    assert.deepEqual(first.appliedAgentProfile, second.appliedAgentProfile);
    assert.deepEqual(writes, ["coding"]);
    let lockedNotification = false;
    core.subscribe((change) => {
      if (
        change.kind === "config_changed" &&
        change.config.agentProfile === "frozen"
      )
        lockedNotification =
          change.appliedAgentProfile?.locked.permission === "planning";
    });
    await core.setAgentProfile("conv_profile", "frozen");
    assert.equal(lockedNotification, true);
    assert.equal(
      core.getSnapshot("conv_profile").config.model.modelId,
      "locked",
    );
    assert.equal(
      core.getSnapshot("conv_profile").config.permissionRuleSetId,
      "planning",
    );
    assert.throws(
      () =>
        core.configure("conv_profile", {
          model: { provider: "test", modelId: "other" },
        }),
      /locked by frozen/,
    );
    assert.throws(
      () => core.configure("conv_profile", { reasoningLevel: "off" }),
      /locked by frozen/,
    );
    assert.throws(
      () =>
        core.configure("conv_profile", { permissionRuleSetId: "autonomous" }),
      /locked by frozen/,
    );
    core.configure("conv_profile", { reasoningLevel: "high" });
    templates.frozen!.instructions = "Edited source instructions";
    assert.equal(
      core.getSnapshot("conv_profile").appliedAgentProfile?.instructions,
      "Original instructions",
    );
    await core.setAgentProfile("conv_profile", "coding");
    const kept = core.getSnapshot("conv_profile");
    assert.equal(kept.config.model.modelId, "locked");
    assert.equal(kept.config.reasoningLevel, "high");
    assert.equal(kept.config.permissionRuleSetId, "planning");
    assert.deepEqual(kept.appliedAgentProfile?.locked, {});
    core.configure("conv_profile", { permissionRuleSetId: "autonomous" });
    assert.deepEqual(writes, ["coding", "frozen", "coding"]);
    await Promise.all([
      core.setAgentProfile("conv_profile", "frozen"),
      core.setAgentProfile("conv_profile", "coding"),
    ]);
    assert.equal(
      core.getSnapshot("conv_profile").config.permissionRuleSetId,
      "planning",
    );
    assert.deepEqual(
      core.getSnapshot("conv_profile").appliedAgentProfile?.locked,
      {},
    );

    opts.agentProfiles.persistApplication = async () => {
      throw new Error("Overlay write failed");
    };
    await assert.rejects(
      core.setAgentProfile("conv_profile", "frozen"),
      /Overlay write failed/,
    );
    assert.equal(
      core.getSnapshot("conv_profile").config.agentProfile,
      "coding",
    );
    await assert.rejects(
      core.createConversation({ id: "conv_failed", projectId: "proj_test" }),
      /Overlay write failed/,
    );
    assert.equal(opts.storage.conversations.get("conv_failed"), null);
  } finally {
    await core.close();
    await rm(directory, { recursive: true, force: true });
  }
});

void test("turns use materialized settings and captured instructions, without resolving the editable source", async () => {
  const config = {
    conversationId: "conv_profile",
    agentProfile: "planning",
    model: { provider: "test", modelId: "stored" },
    reasoningLevel: "high" as const,
    permissionRuleSetId: "planning",
    workingDirectory: "/tmp",
    systemPrompt: null,
    instructions: null,
  };
  const stored = structuredClone(config);
  const applied: AppliedAgentProfile = {
    schemaVersion: 1,
    name: "planning",
    instructions: "Captured instructions",
    locked: { permission: "planning" },
  };
  const port: AgentProfilePort = {
    async applyProfile() {
      throw new Error("Must not resolve source on a turn");
    },
    async persistApplication() {
      throw new Error("Must not persist on a turn");
    },
    getAppliedProfile() {
      return applied;
    },
  };
  const turn = new ModelTurn(
    {
      async resolve(selection) {
        assert.equal(selection.modelId, "stored");
        return { model: { id: "stored" } as PiModel };
      },
    },
    {
      async prepare(input) {
        assert.equal(input.config.permissionRuleSetId, "planning");
        assert.deepEqual(input.appliedAgentProfile, applied);
        return {
          systemPrompt: input.appliedAgentProfile!.instructions,
          tools: [],
        };
      },
    },
    () => [],
    () => {},
    undefined,
    port,
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
  assert.equal(prepared.systemPrompt, "Captured instructions");
  assert.equal(prepared.reasoning, "high");
  assert.deepEqual(config, stored);
});

void test("pending initial capabilities reach start-template application before its Locks materialize", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "nerve-initial-capabilities-"),
  );
  const opts = options(
    directory,
    ":memory:",
    {
      async resolve() {
        throw new Error("No model expected");
      },
    },
    {
      async execute() {
        throw new Error("No tool expected");
      },
      isReplaySafe: () => false,
    },
  );
  const profile: AgentProfileDraft = {
    name: "planning",
    description: "Start",
    usableBy: "lead",
    instructions: "Captured",
    tools: {
      python_exec: {
        lock: {
          enabled: false,
          settings: { interpreterPath: "/locked/python" },
        },
      },
    },
  };
  let persisted: AgentProfileApplication | undefined;
  const initial: CapabilityOverridesDocument = {
    schemaVersion: 3,
    tools: {
      python_exec: {
        enabled: true,
        settings: { interpreterPath: "/pending/python" },
      },
      web_fetch: { enabled: false },
    },
    skills: { file: {}, nerve: {}, agentBrowser: {} },
  };
  opts.agentProfiles = {
    async applyProfile(input) {
      assert.deepEqual(input.capabilityOverrides, initial);
      assert.equal(input.config.model.modelId, "pending");
      assert.equal(input.config.reasoningLevel, "low");
      const { settings, applied } = applyAgentProfileTemplate(
        profile,
        {
          model: input.config.model,
          thinking: input.config.reasoningLevel,
          permission: input.config.permissionRuleSetId,
          compaction: defaultSettings.compaction,
          tools: input.capabilityOverrides!.tools,
          skills: input.capabilityOverrides!.skills,
        },
        { clampThinking: (_model, thinking) => thinking },
      );
      return {
        config: {
          agentProfile: profile.name,
          model: settings.model,
          reasoningLevel: settings.thinking,
        },
        applied,
        capabilityOverrides: {
          schemaVersion: 3,
          tools: settings.tools,
          skills: initial.skills,
        },
      };
    },
    async persistApplication(_id, application) {
      persisted = structuredClone(application);
    },
    getAppliedProfile() {
      return persisted?.applied ?? null;
    },
  };
  const core = new ConversationCore(opts);
  try {
    core.projects.create({ id: "proj_test", name: "Test", directory });
    const config = await opts.defaultConfig("proj_test");
    const created = await core.createConversation({
      id: "conv_pending",
      projectId: "proj_test",
      capabilityOverrides: initial,
      config: {
        ...config,
        agentProfile: "planning",
        model: { provider: "test", modelId: "pending" },
        reasoningLevel: "low",
      },
    });
    assert.deepEqual(persisted!.capabilityOverrides!.tools.python_exec, {
      enabled: false,
      settings: { interpreterPath: "/locked/python" },
    });
    assert.deepEqual(persisted!.capabilityOverrides!.tools.web_fetch, {
      enabled: false,
    });
    assert.deepEqual(
      created.appliedAgentProfile!.locked.tools?.python_exec,
      persisted!.capabilityOverrides!.tools.python_exec,
    );
    assert.equal(created.config.model.modelId, "pending");
    assert.equal(initial.tools.python_exec!.enabled, true);
  } finally {
    await core.close();
    await rm(directory, { recursive: true, force: true });
  }
});
