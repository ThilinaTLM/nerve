import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveAgentProfiles,
  type AgentProfile,
} from "@nervekit/contracts/agent-profiles";
import { defaultSettings } from "@nervekit/contracts/settings";
import { emptyCapabilityOverrides } from "@nervekit/contracts/capabilities";
import { createAgentProfilePort } from "./agent-profile-policy.js";
import { switchScalar } from "./agent-profile-scalars.js";
import type { AgentProfileService } from "../domains/agent-profiles/agent-profile.service.js";

void test("switch scalar preserves user changes, clears prior Sets, and never writes Locks", () => {
  assert.equal(
    switchScalar("inherit", "inherit", "user", "default-value"),
    "user",
  );
  assert.equal(
    switchScalar("profile-value", "inherit", "profile-value", "default-value"),
    "default-value",
  );
  assert.equal(
    switchScalar("profile-value", "inherit", "user", "default-value"),
    "user",
  );
  assert.equal(
    switchScalar({ lock: "locked" }, "inherit", "user", "default-value"),
    "user",
  );
  assert.equal(
    switchScalar("inherit", { lock: "locked" }, "user", "default-value"),
    undefined,
  );
  assert.equal(
    switchScalar("inherit", "default", "user", "default-value"),
    "default-value",
  );
});

const setup = (
  custom: AgentProfile[] = [],
  compaction: {
    auto: boolean;
    profile: "balanced" | "aggressive";
    triggerPercent: number;
  } = { auto: true, profile: "balanced", triggerPercent: 80 },
) => {
  const profiles = [
    ...resolveAgentProfiles({ layers: [], scope: "user" }).profiles.flatMap(
      (p) => (p.effective ? [p.effective] : []),
    ),
    ...custom,
  ];
  const overrides = emptyCapabilityOverrides();
  overrides.tools.plan_present = { enabled: false };
  overrides.tools.web_fetch = { enabled: false };
  const port = createAgentProfilePort({
    profiles: () =>
      ({ list: async () => profiles }) as unknown as AgentProfileService,
    settings: async () => ({
      ...defaultSettings,
      defaultModel: { provider: "test", modelId: "default" },
    }),
    compaction: async () => compaction,
    capabilities: async () => overrides,
  });
  const input = {
    conversation: {
      id: "c",
      projectId: "p",
      parentConversationId: null as string | null,
    },
    projectDir: "/project",
    config: {
      agentProfile: "coding",
      model: { provider: "test", modelId: "user" },
      reasoningLevel: "high" as const,
      permissionRuleSetId: "autonomous",
      instructions: null,
      systemPrompt: null,
      workingDirectory: "/project",
    },
  };
  return { port, input, overrides };
};

void test("Planning locks permission without persisting it and clears only claimed capability toggles", async () => {
  const { port, input, overrides } = setup();
  const patch = await port.switchProfile({ ...input, profile: "planning" });
  assert.equal(patch.config.agentProfile, "planning");
  assert.equal(patch.config.permissionRuleSetId, undefined);
  assert.deepEqual(patch.config.model, input.config.model);
  assert.equal(patch.capabilityOverrides?.tools.plan_present, undefined);
  assert.deepEqual(patch.capabilityOverrides?.tools.web_fetch, {
    enabled: false,
  });
  assert.deepEqual(
    overrides.tools.plan_present,
    { enabled: false },
    "policy does not mutate stored overlays",
  );
  const locks = await port.resolveLockedScalars({
    ...input,
    config: { ...input.config, agentProfile: "planning" },
  });
  assert.deepEqual(locks, { permissionRuleSetId: "planning" });
});

void test("plan approval resolves default profile, reapplies its Sets, and rejects sub-agent switches", async () => {
  const { port, input } = setup();
  const patch = await port.switchProfile({
    ...input,
    config: { ...input.config, agentProfile: "planning" },
  });
  assert.equal(patch.config.agentProfile, "coding");
  assert.equal(
    patch.config.permissionRuleSetId,
    defaultSettings.defaultPermissionRuleSetId ?? "baseline",
  );
  await assert.rejects(
    port.switchProfile({ ...input, profile: "explore" }),
    /not usable by lead/,
  );
  await assert.rejects(
    port.switchProfile({
      ...input,
      conversation: { ...input.conversation, parentConversationId: "lead" },
      profile: "coding",
    }),
    /cannot be switched/,
  );
});

void test("leaving a Set compaction restores defaults only while the profile value remains unchanged", async () => {
  const profile = {
    ...resolveAgentProfiles({ layers: [], scope: "user" }).profiles.find(
      (p) => p.name === "coding",
    )!.effective!,
    name: "compact",
    compaction: { profile: "aggressive" as const },
  };
  const { port, input } = setup([profile]);
  const applied = await port.switchProfile({ ...input, profile: "compact" });
  assert.deepEqual(applied.compaction, {
    auto: true,
    profile: "aggressive",
    triggerPercent: 80,
  });
  const { port: active } = setup([profile], {
    auto: true,
    profile: "aggressive",
    triggerPercent: 80,
  });
  const left = await active.switchProfile({
    ...input,
    config: { ...input.config, agentProfile: "compact" },
    profile: "coding",
  });
  assert.equal(left.compaction, null);
  const { port: changed } = setup([profile], {
    auto: false,
    profile: "aggressive",
    triggerPercent: 70,
  });
  const preserved = await changed.switchProfile({
    ...input,
    config: { ...input.config, agentProfile: "compact" },
    profile: "coding",
  });
  assert.deepEqual(preserved.compaction, {
    auto: false,
    profile: "aggressive",
    triggerPercent: 70,
  });
});

void test("Lock defaults resolve from settings each turn and never affect sub-agent snapshots", async () => {
  const profile: AgentProfile = {
    ...resolveAgentProfiles({ layers: [], scope: "user" }).profiles.find(
      (p) => p.name === "coding",
    )!.effective!,
    name: "locked",
    model: { lock: "default" },
    thinking: { lock: "default" },
    permission: { lock: "default" },
    compaction: { lock: "default" },
  };
  const { port, input } = setup([profile]);
  const active = {
    ...input,
    config: { ...input.config, agentProfile: "locked" },
  };
  const locks = await port.resolveLockedScalars(active);
  assert.deepEqual(locks.model, { provider: "test", modelId: "default" });
  assert.equal(locks.reasoningLevel, defaultSettings.defaultThinkingLevel);
  assert.equal(
    locks.permissionRuleSetId,
    defaultSettings.defaultPermissionRuleSetId ?? "baseline",
  );
  assert.equal(locks.compaction?.profile, defaultSettings.compaction.profile);
  profile.permission = { lock: "read_only" };
  assert.equal(
    (await port.resolveLockedScalars(active)).permissionRuleSetId,
    "read_only",
  );
  assert.deepEqual(
    await port.resolveLockedScalars({
      ...active,
      conversation: { ...active.conversation, parentConversationId: "lead" },
    }),
    {},
  );
});
