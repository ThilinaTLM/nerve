import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { profileTransitionPreviewSchema } from "@nervekit/contracts/agent-configuration";
import type { CoreStorage } from "@nervekit/conversation-core";
import { AgentConfigurationService } from "./agent-configuration-service.js";
import { createProfileTransitions } from "./profile-transitions.js";

void test("transition previews include target metadata/instructions, changed values/sources only, and unchanged requirements", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "nerve-profile-preview-"));
  const planning = {
    schemaVersion: 1 as const,
    name: "planning",
    description: "Plan without implementation",
    usableBy: "lead" as const,
    instructions: "Plan instructions",
    requirements: {
      permissionRuleSetId: "planning",
      tools: { plan_present: { enabled: true } },
    },
  };
  const coding = {
    schemaVersion: 1 as const,
    name: "coding",
    description: "Implement",
    usableBy: "lead" as const,
    instructions: "Coding instructions",
  };
  const service = new AgentConfigurationService({
    home,
    projectDirectory: () => home,
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
    builtins: {
      planning: JSON.stringify(planning),
      coding: JSON.stringify(coding),
    },
    isProfileTrusted: () => true,
    captureResources: () => ({
      options: { referenceAvailable: () => true },
      isCurrent: () => true,
    }),
  });
  t.after(async () => {
    await service.flushSummaries();
    await rm(home, { recursive: true, force: true });
  });
  await mkdir(path.dirname(service.paths.agent({ scope: "user" })), {
    recursive: true,
  });
  await writeFile(
    service.paths.agent({ scope: "user" }),
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      overrides: {
        model: { provider: "test", modelId: "m" },
        permissionRuleSetId: "autonomous",
        tools: { plan_present: { enabled: true } },
      },
    }),
  );
  const lookup = await service.profiles.get("planning", "p");
  if (lookup.status !== "available")
    throw new Error("Missing planning profile");
  await service.createConversation("c", {
    schemaVersion: 1,
    revision: 1,
    appliedProfile: {
      name: "planning",
      source: "builtin",
      sourceDigest: lookup.digest,
      instructions: planning.instructions,
      recommendations: {},
      requirements: planning.requirements,
    },
    overrides: {},
  });
  const lifecycle = createProfileTransitions(service, {} as CoreStorage);
  const unchanged = await lifecycle.port.preview("c", "planning");
  assert.equal(unchanged.status, "ready");
  if (unchanged.status !== "ready") throw new Error("Expected preview");
  const same = profileTransitionPreviewSchema.parse(unchanged.preview);
  assert.deepEqual(same.changedFields, []);
  assert.deepEqual(
    same.unchangedRequirements.map((entry) => entry.pointer).sort(),
    ["/permissionRuleSetId", "/tools/plan_present/enabled"],
  );
  const changed = await lifecycle.port.preview("c", "coding");
  if (changed.status !== "ready") throw new Error("Expected coding preview");
  const preview = profileTransitionPreviewSchema.parse(changed.preview);
  assert.equal(preview.targetDefinition.instructions, coding.instructions);
  assert.equal(preview.targetDefinition.description, coding.description);
  assert.equal(
    preview.changedFields.some((entry) => entry.pointer === "/model"),
    false,
  );
  assert.deepEqual(
    preview.changedFields.find(
      (entry) => entry.pointer === "/appliedProfile/instructions",
    ),
    {
      pointer: "/appliedProfile/instructions",
      before: planning.instructions,
      after: coding.instructions,
      beforeSource: undefined,
      afterSource: undefined,
    },
  );
  const unlocked = preview.changedFields.find(
    (entry) => entry.pointer === "/tools/plan_present/enabled",
  )!;
  assert.equal(unlocked.before, true);
  assert.equal(unlocked.after, true);
  assert.equal(unlocked.beforeSource?.source, "requirement");
  assert.equal(unlocked.afterSource?.source, "user");
});

void test("declared model levels diagnose unsupported requirements and block transitions while fitting frozen child preferences", async (t) => {
  const { clampAgentThinkingLevel } = await import("@nervekit/harness/models");
  const { freezeChildPreferences } =
    await import("@nervekit/contracts/agent-configuration");
  const home = await mkdtemp(path.join(tmpdir(), "nerve-declared-levels-"));
  const model = {
    provider: "server-declared-levels",
    modelId: "low",
    name: "Low",
    reasoning: true,
    supportedThinkingLevels: ["off", "low"] as ("off" | "low")[],
    api: "openai-completions",
    baseUrl: "http://localhost.invalid/v1",
  };
  const clampThinking = (
    selection: Parameters<typeof clampAgentThinkingLevel>[0],
    level: Parameters<typeof clampAgentThinkingLevel>[1],
  ) => clampAgentThinkingLevel(selection, level, [model]);
  const definition = {
    schemaVersion: 1,
    name: "unsupported",
    description: "Unsupported requirement",
    instructions: "Short",
    usableBy: "lead",
    requirements: { reasoningLevel: "high" },
  };
  const service = new AgentConfigurationService({
    home,
    projectDirectory: () => home,
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
    builtins: { unsupported: JSON.stringify(definition) },
    isProfileTrusted: () => true,
    captureResources: () => ({
      options: { clampThinking, referenceAvailable: () => true },
      isCurrent: () => true,
    }),
  });
  t.after(async () => {
    await service.flushSummaries();
    await rm(home, { recursive: true, force: true });
  });
  await mkdir(path.join(home, "config"));
  await writeFile(
    service.paths.agent({ scope: "user" }),
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      overrides: {
        model: { provider: model.provider, modelId: model.modelId },
        reasoningLevel: "low",
      },
    }),
  );
  await service.createConversation("c", {
    schemaVersion: 1,
    revision: 1,
    appliedProfile: null,
    overrides: {},
  });
  const events: import("@nervekit/contracts/core").ConversationEvent[] = [];
  const storage = {
    events: {
      get: (id: string) => events.find((event) => event.id === id) ?? null,
      append: (input: Parameters<CoreStorage["events"]["append"]>[0]) => {
        const event = {
          ...input,
          sequence: events.length + 1,
        } as import("@nervekit/contracts/core").ConversationEvent;
        events.push(event);
        return event;
      },
      since: () => events,
    },
  } as unknown as CoreStorage;
  const lifecycle = createProfileTransitions(service, storage);
  const preview = await lifecycle.port.preview("c", "unsupported");
  assert.equal(preview.status, "ready");
  if (preview.status !== "ready") throw new Error("Expected preview");
  assert.ok(
    preview.preview.resolution.diagnostics.some(
      (issue) => issue.code === "unsupported-reasoning",
    ),
  );
  const result = await lifecycle.port.apply({
    conversationId: "c",
    kind: "profile",
    action: "switch",
    targetProfile: preview.preview.targetProfile,
    expectedRevision: preview.preview.expectedRevision,
    expectedDigest: preview.preview.expectedDigest,
    transitionId: "bad-requirement",
  });
  assert.equal(result.status, "refresh_required");
  if (result.status === "refresh_required")
    assert.equal(result.reason, "requirement_conflict");
  assert.equal(
    (await service.ensureLoaded({ scope: "conversation", conversationId: "c" }))
      .status,
    "ready",
  );
  const frozen = freezeChildPreferences({
    user: { reasoningLevel: "high" },
    appliedProfile: {
      name: "child",
      source: "builtin",
      sourceDigest: "a".repeat(64),
      instructions: "",
      recommendations: {
        model: { provider: model.provider, modelId: model.modelId },
      },
      requirements: {},
    },
    clampThinking,
  });
  assert.equal(frozen.reasoningLevel, "low");
});
