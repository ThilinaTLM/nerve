import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSettings } from "@nervekit/contracts/settings";
import type { ConversationConfig } from "@nervekit/contracts/core";
import { AgentProfileService } from "../domains/agent-profiles/agent-profile.service.js";
import { CapabilityService } from "./capability.service.js";
import { ConversationHarnessSettings } from "./conversation-harness.service.js";
import { createAgentProfilePort } from "./agent-profile-policy.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-applied-profile-"));
  const projectDir = join(root, "project");
  await mkdir(projectDir);
  const settings = {
    ...structuredClone(defaultSettings),
    defaultModel: { provider: "test", modelId: "default" },
  };
  const config: ConversationConfig = {
    conversationId: "c",
    agentProfile: "coding",
    model: { provider: "test", modelId: "user" },
    reasoningLevel: "high",
    permissionRuleSetId: "autonomous",
    instructions: null,
    systemPrompt: null,
    workingDirectory: projectDir,
  };
  const conversation = { id: "c", projectId: "p", parentConversationId: null };
  const profiles = new AgentProfileService({
    userPath: join(root, "data", "agent-profiles"),
    getProject: (id) => ({ id, directory: projectDir }),
    getConversation: () => ({ projectId: "p" }),
    trust: { isTrusted: () => true, decide: () => ({}) as never },
    events: { publish: async () => {} },
  });
  const core = {
    getSnapshot: () => ({
      conversation,
      config,
      appliedAgentProfile: port.getAppliedProfile("c"),
    }),
    projects: { get: () => ({ id: "p", directory: projectDir }) },
    trust: { list: () => [], isTrusted: () => false },
  };
  const capabilities = new CapabilityService(
    { paths: { dataPath: join(root, "data"), home: root }, settings } as never,
    core as never,
  );
  const harness = new ConversationHarnessSettings({
    dataPath: join(root, "data"),
    userCompaction: () => settings.compaction,
    projectCompaction: async () => settings.compaction,
    projectOf: () => "p",
    appliedProfile: (id) => port.getAppliedProfile(id),
    changed: () => {},
  });
  const port = createAgentProfilePort({
    clampThinking: (model, thinking) =>
      model.modelId === "no-reasoning" ? "off" : thinking,
    dataPath: join(root, "data"),
    home: root,
    profiles: () => profiles,
    settings: async () => settings,
    capabilities: () => capabilities,
    harness: () => harness,
    parentInput: () => input,
    skillCatalogs: { nerve: [], agentBrowser: [] },
  });
  const input = { conversation, config, projectDir };
  const apply = async (name: string) => {
    const application = await port.applyProfile({ ...input, profile: name });
    await port.persistApplication("c", application);
    Object.assign(config, application.config);
    return application;
  };
  return {
    root,
    settings,
    port,
    input,
    profiles,
    capabilities,
    harness,
    apply,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

void test("Planning materializes permission and tool config; Coding resets both to application settings", async () => {
  const f = await fixture();
  try {
    const application = await f.apply("planning");
    assert.equal(application.config.permissionRuleSetId, "planning");
    assert.deepEqual(
      f.port.getAppliedProfile("c")?.locked.permission,
      "planning",
    );
    assert.equal(
      (await f.capabilities.settings("p", "c")).tools.planPresent
        .approvalProfile,
      "coding",
    );
    assert.ok(
      (await f.capabilities.configuration("p", "c")).conversation?.tools
        .plan_present?.enabled,
    );
    // Resolve at apply time rather than pinning a bundled permission choice.
    f.settings.defaultPermissionRuleSetId = "read_only";
    const coding = await f.apply("coding");
    assert.equal(coding.config.permissionRuleSetId, "read_only");
    assert.deepEqual(coding.applied.locked, {});
    const configuration = await f.capabilities.configuration("p", "c");
    assert.equal(configuration.conversation?.tools.plan_present, undefined);
    assert.ok(configuration.effective.disabledTools.includes("plan_present"));
    const persisted = JSON.parse(
      await readFile(
        join(f.root, "data/conversations/c/config/applied-agent-profile.json"),
        "utf8",
      ),
    );
    assert.equal(persisted.name, "coding");
  } finally {
    await f.cleanup();
  }
});

void test("Reset to settings clears selected tool and skill overrides without clearing other tools", async () => {
  const f = await fixture();
  try {
    await f.profiles.update({
      scope: "user",
      name: "resetter",
      patch: {
        description: "Reset selected settings",
        usableBy: "lead",
        instructions: "",
        tools: { web_fetch: "settings" },
        skills: "settings",
      },
    });
    await f.capabilities.update({
      projectId: "p",
      conversationId: "c",
      layer: "conversation",
      patch: {
        tools: {
          web_fetch: { enabled: false },
          python_exec: { enabled: false },
        },
        skills: { file: { custom: false } },
      },
    });
    await f.apply("resetter");
    const next = await f.capabilities.configuration("p", "c");
    assert.equal(next.conversation?.tools.web_fetch, undefined);
    assert.equal(next.conversation?.tools.python_exec?.enabled, false);
    assert.deepEqual(next.conversation?.skills, {
      file: {},
      nerve: {},
      agentBrowser: {},
    });
  } finally {
    await f.cleanup();
  }
});

void test("template edits and deletion do not change applied instructions or locks", async () => {
  const f = await fixture();
  try {
    await f.profiles.update({
      scope: "user",
      name: "custom",
      patch: {
        description: "Custom",
        usableBy: "lead",
        instructions: "Initial",
        permission: { lock: "read_only" },
      },
    });
    await f.apply("custom");
    await f.profiles.update({
      scope: "user",
      name: "custom",
      patch: { instructions: "Edited", permission: { lock: "autonomous" } },
    });
    await f.profiles.reset({ scope: "user", name: "custom" });
    assert.equal(f.port.getAppliedProfile("c")?.instructions, "Initial");
    assert.equal(f.port.getAppliedProfile("c")?.locked.permission, "read_only");
    const copy = f.port.getAppliedProfile("c")!;
    copy.instructions = "Mutated";
    assert.equal(f.port.getAppliedProfile("c")?.instructions, "Initial");
  } finally {
    await f.cleanup();
  }
});

void test("host tool, skill, compaction mutation and reset paths enforce applied locks", async () => {
  const f = await fixture();
  try {
    await f.profiles.update({
      scope: "user",
      name: "locked",
      patch: {
        description: "Locked",
        usableBy: "lead",
        instructions: "",
        compaction: {
          lock: { auto: false, profile: "balanced", customTriggerPercent: 80 },
        },
        tools: { web_fetch: { lock: { enabled: false } } },
        skills: { lock: "none" },
      },
    });
    await f.apply("locked");
    await assert.rejects(
      f.capabilities.update({
        projectId: "p",
        conversationId: "c",
        layer: "conversation",
        patch: { tools: { web_fetch: { enabled: true } } },
      }),
      /locked/,
    );
    await assert.rejects(
      f.capabilities.reset({
        projectId: "p",
        conversationId: "c",
        layer: "conversation",
      }),
      /locked/,
    );
    await assert.rejects(f.harness.update("p", "c", null), /locked/);
    assert.equal((await f.harness.compactionSettings("c")).auto, false);
  } finally {
    await f.cleanup();
  }
});

void test("Same as lead is explicit; child Use settings starts from application defaults", async () => {
  const f = await fixture();
  try {
    await f.apply("planning");
    await f.profiles.update({
      scope: "user",
      name: "child",
      patch: {
        description: "Child",
        usableBy: "subagent",
        instructions: "Child rules",
        model: "lead",
        thinking: "lead",
        permission: "lead",
      },
    });
    const child = await f.port.applyProfile({
      conversation: { projectId: "p", parentConversationId: "c" },
      config: {
        ...f.input.config,
        permissionRuleSetId: "baseline",
        model: { provider: "test", modelId: "default" },
      },
      projectDir: f.input.projectDir,
      profile: "child",
    });
    assert.deepEqual(child.config.model, f.input.config.model);
    assert.equal(child.config.permissionRuleSetId, "planning");
    assert.deepEqual(child.applied.locked, {});
  } finally {
    await f.cleanup();
  }
});

void test("pending model and capability choices are the input layer, and template Locks win during initial application", async () => {
  const f = await fixture();
  try {
    await f.profiles.update({
      scope: "user",
      name: "initial",
      patch: {
        description: "Initial lock",
        usableBy: "lead",
        instructions: "",
        model: {
          lock: { provider: "test", modelId: "locked" },
        },
        thinking: { lock: "off" },
        tools: {
          python_exec: {
            lock: {
              enabled: true,
              settings: { interpreterPath: "/locked/python" },
            },
          },
        },
      },
    });
    const application = await f.port.applyProfile({
      conversation: { projectId: "p", parentConversationId: null },
      projectDir: f.input.projectDir,
      config: {
        ...f.input.config,
        model: { provider: "test", modelId: "pending-choice" },
        reasoningLevel: "high",
      },
      capabilityOverrides: {
        schemaVersion: 3,
        tools: {
          python_exec: {
            enabled: false,
            settings: { interpreterPath: "/pending/python" },
          },
          web_fetch: { enabled: false },
        },
        skills: { file: {}, nerve: {}, agentBrowser: {} },
      },
      profile: "initial",
    });
    assert.deepEqual(application.config.model, {
      provider: "test",
      modelId: "locked",
    });
    assert.equal(application.config.reasoningLevel, "off");
    assert.deepEqual(application.capabilityOverrides?.tools.python_exec, {
      enabled: true,
      settings: { interpreterPath: "/locked/python" },
    });
    assert.deepEqual(application.capabilityOverrides?.tools.web_fetch, {
      enabled: false,
    });
    assert.equal(
      f.port.getAppliedProfile("c"),
      null,
      "preflight does not persist an application",
    );
  } finally {
    await f.cleanup();
  }
});

void test("thinking-only settings do not pin model; clamping precedes capture of a thinking Lock", async () => {
  const f = await fixture();
  try {
    await f.profiles.update({
      scope: "user",
      name: "thinking-only",
      patch: {
        description: "Thinking only",
        usableBy: "lead",
        instructions: "",
        thinking: { lock: "high" },
      },
    });
    const application = await f.port.applyProfile({
      ...f.input,
      config: {
        ...f.input.config,
        model: { provider: "test", modelId: "no-reasoning" },
      },
      profile: "thinking-only",
    });
    assert.deepEqual(application.config.model, {
      provider: "test",
      modelId: "no-reasoning",
    });
    assert.equal(application.config.reasoningLevel, "off");
    assert.equal(application.applied.locked.thinking, "off");
    assert.equal(application.applied.locked.model, undefined);
    await f.port.persistApplication("c", application);
    assert.equal(f.port.getAppliedProfile("c")?.locked.thinking, "off");
  } finally {
    await f.cleanup();
  }
});

void test("approval preserves model and thinking independently, while each target Lock wins", async () => {
  const f = await fixture();
  try {
    await f.profiles.update({
      scope: "user",
      name: "approval",
      patch: {
        description: "Approval",
        usableBy: "lead",
        instructions: "",
        model: { set: { provider: "test", modelId: "target" } },
        thinking: { set: "low" },
      },
    });
    const modelOnly = await f.port.applyProfile({
      ...f.input,
      profile: "approval",
      preserveModel: true,
    });
    assert.deepEqual(modelOnly.config.model, f.input.config.model);
    assert.equal(modelOnly.config.reasoningLevel, "low");
    const thinkingOnly = await f.port.applyProfile({
      ...f.input,
      profile: "approval",
      preserveThinking: true,
    });
    assert.equal(thinkingOnly.config.model?.modelId, "target");
    assert.equal(thinkingOnly.config.reasoningLevel, "high");
    await f.profiles.update({
      scope: "user",
      name: "approval",
      patch: {
        model: { lock: { provider: "test", modelId: "locked" } },
        thinking: { lock: "off" },
      },
    });
    const locked = await f.port.applyProfile({
      ...f.input,
      profile: "approval",
      preserveModel: true,
      preserveThinking: true,
    });
    assert.equal(locked.config.model?.modelId, "locked");
    assert.equal(locked.config.reasoningLevel, "off");
  } finally {
    await f.cleanup();
  }
});
