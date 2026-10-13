import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubagentProfileService } from "../domains/subagents/subagent-profile.service.js";
import type { ConversationConfig } from "@nervekit/contracts/core";
import {
  builtInSubagentProfiles,
  type SubagentProfile,
} from "@nervekit/contracts/subagents";
import type { AgentModelInfo } from "@nervekit/harness/models";
import { createProfileAvailability } from "./subagent-profile-availability.js";
import { createSubagentHost } from "./subagent-host.js";

void test("parent changes during model availability cannot change the validated creation snapshot", async () => {
  const parent = {
    model: { provider: "provider", modelId: "reasoning" },
    reasoningLevel: "high",
  } as ConversationConfig;
  const profile: SubagentProfile = {
    ...builtInSubagentProfiles[0],
    source: "builtin",
    model: "lead",
    thinking: "lead",
    tools: {},
    skills: "inherit",
  };
  let release = () => {};
  let checking = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    checking = resolve;
  });
  const validated: unknown[] = [];
  const availability = createProfileAvailability({
    parent: () => parent,
    resources: async () => ({ tools: new Map(), skills: new Map() }),
    modelInfo: async (selection) => {
      validated.push(structuredClone(selection));
      checking();
      await blocked;
      return {
        supportedThinkingLevels:
          selection.modelId === "reasoning" ? ["off", "high"] : ["off"],
      } as AgentModelInfo;
    },
  });
  const host = createSubagentHost({
    profiles: { usable: async () => [profile], find: async () => profile },
    availability,
    parent: () => ({ projectId: "p", config: parent }),
    models: {
      resolve: async () => {
        throw new Error("No authoritative lookup needed for inherited model");
      },
    },
    harness: { initialize: async () => {} },
    initializeCapabilities: async () => {},
  });
  const resolving = host.resolveProfile({
    parentId: "lead",
    profile: profile.name,
  });
  await started;
  parent.model.modelId = "non-reasoning";
  parent.reasoningLevel = "low";
  release();
  const resolved = await resolving;
  assert.deepEqual(validated, [{ provider: "provider", modelId: "reasoning" }]);
  assert.deepEqual(resolved.config.model, {
    provider: "provider",
    modelId: "reasoning",
  });
  assert.equal(resolved.config.reasoningLevel, "high");
});

void test("real profile service validates the same captured parent tuple as child creation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nerve-profile-snapshot-"));
  try {
    const projectDir = join(dir, "project");
    await mkdir(projectDir);
    const parent = {
      model: { provider: "provider", modelId: "reasoning" },
      reasoningLevel: "high",
    } as ConversationConfig;
    let release = () => {};
    let checking = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      checking = resolve;
    });
    const validated: unknown[] = [];
    const availability = createProfileAvailability({
      parent: () => parent,
      resources: async () => ({ tools: new Map(), skills: new Map() }),
      modelInfo: async (selection) => {
        validated.push(structuredClone(selection));
        checking();
        await blocked;
        return {
          supportedThinkingLevels:
            selection.modelId === "reasoning" ? ["off", "high"] : ["off"],
        } as AgentModelInfo;
      },
    });
    const profiles = new SubagentProfileService({
      userPath: join(dir, "config", "subagents.json"),
      conversationsPath: join(dir, "conversations"),
      getProject: (id) => ({ id, directory: projectDir }),
      getConversation: () => ({ projectId: "p" }),
      trust: {
        isTrusted: () => true,
        decide: () => {
          throw new Error("No trust mutation expected");
        },
      },
      events: { publish: async () => {} },
      availability,
    });
    const host = createSubagentHost({
      profiles,
      availability,
      parent: () => ({ projectId: "p", config: parent }),
      models: {
        resolve: async () => {
          throw new Error("No explicit model expected");
        },
      },
      harness: { initialize: async () => {} },
      initializeCapabilities: async () => {},
    });
    const resolving = host.resolveProfile({
      parentId: "lead",
      profile: "explore",
    });
    await started;
    const advertising = host.usableProfiles("lead");
    parent.model.modelId = "non-reasoning";
    parent.reasoningLevel = "low";
    release();
    const resolved = await resolving;
    assert.ok((await advertising).includes("explore"));
    assert.ok(
      validated.length >= 2,
      "service and host both validate availability",
    );
    for (const selection of validated)
      assert.deepEqual(selection, {
        provider: "provider",
        modelId: "reasoning",
      });
    assert.deepEqual(resolved.config.model, {
      provider: "provider",
      modelId: "reasoning",
    });
    assert.equal(resolved.config.reasoningLevel, "high");
    await resolved.initializeChild("child");
    assert.deepEqual(await host.usableProfiles("lead"), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
