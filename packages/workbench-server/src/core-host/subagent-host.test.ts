import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationConfig } from "@nervekit/contracts/core";
import type { SubagentProfile } from "@nervekit/contracts/subagents";
import { createProfileAvailability } from "./subagent-profile-availability.js";
import { createSubagentHost } from "./subagent-host.js";

const lead = {
  model: { provider: "anthropic", modelId: "lead-model" },
  reasoningLevel: "high",
} as ConversationConfig;

const profile = (
  name: string,
  patch: Partial<SubagentProfile> = {},
): SubagentProfile => ({
  name,
  label: name,
  description: `${name} work`,
  enabled: true,
  source: "user",
  model: "lead",
  thinking: "lead",
  permission: "read_only",
  compaction: "inherit",
  tools: {},
  skills: "inherit",
  instructions: "",
  ...patch,
});

function setup(profiles: SubagentProfile[], unavailable = false) {
  const calls: string[] = [];
  const initialized: unknown[] = [];
  const capabilitySnapshots: SubagentProfile[] = [];
  const host = createSubagentHost({
    profiles: {
      usable: async () =>
        profiles.filter(
          (item) => item.enabled && !item.error && item.trust !== "untrusted",
        ),
      find: async (_context, name) => profiles.find((p) => p.name === name),
    },
    availability: createProfileAvailability({
      parent: () => lead,
      resources: async () => ({ tools: new Map(), skills: new Map() }),
      modelInfo: async () => {
        if (unavailable) throw new Error("Model unavailable");
        return {
          supportedThinkingLevels: [
            "off",
            "minimal",
            "low",
            "medium",
            "high",
            "xhigh",
          ],
        } as never;
      },
    }),
    models: {
      resolve: async (selection) => {
        calls.push(`${selection.provider}/${selection.modelId}`);
        if (unavailable) throw new Error("Model unavailable");
        return { model: {} as never };
      },
    },
    harness: {
      initialize: async (id, compaction) => {
        initialized.push([id, compaction]);
      },
    },
    parent: () => ({ projectId: "p", config: lead }),
    initializeCapabilities: async (_p, child, profile) => {
      capabilitySnapshots.push(profile);
      initialized.push(child);
    },
  });
  return { host, calls, initialized, capabilitySnapshots };
}

void test("lead model and thinking are copied; instructions and permission map", async () => {
  const { host, calls } = setup([
    profile("scout", { instructions: "Be brief", permission: "autonomous" }),
    profile("blank", { instructions: "  \n" }),
  ]);
  const resolved = await host.resolveProfile({
    parentId: "x",
    profile: "scout",
  });
  assert.deepEqual(resolved.config, {
    model: lead.model,
    reasoningLevel: "high",
    permissionRuleSetId: "autonomous",
    instructions: "Be brief",
  });
  assert.equal(
    (await host.resolveProfile({ parentId: "x", profile: "blank" })).config
      .instructions,
    null,
  );
  assert.deepEqual(calls, []);
});

void test("explicit model and thinking are resolved through the model port", async () => {
  const { host, calls } = setup([
    profile("deep", { model: "openai/gpt-x/y", thinking: "low" }),
  ]);
  const { config } = await host.resolveProfile({
    parentId: "x",
    profile: "deep",
  });
  assert.deepEqual(config.model, { provider: "openai", modelId: "gpt-x/y" });
  assert.equal(config.reasoningLevel, "low");
  assert.deepEqual(calls, ["openai/gpt-x/y"]);
});

void test("an unavailable model fails creation with a clear error", async () => {
  const { host } = setup([profile("deep", { model: "openai/nope" })], true);
  await assert.rejects(
    host.resolveProfile({ parentId: "x", profile: "deep" }),
    /Model openai\/nope is not available/,
  );
});

void test("unknown, disabled, invalid and untrusted profiles list the usable names", async () => {
  const { host } = setup([
    profile("ok"),
    profile("off", { enabled: false }),
    profile("bad", { error: "broken" }),
    profile("new", { source: "project", trust: "untrusted" }),
  ]);
  for (const [name, reason] of [
    ["ghost", /does not exist.*Usable profiles: ok\./],
    ["off", /is disabled.*Usable profiles: ok\./],
    ["bad", /is invalid \(broken\)/],
    ["new", /not trusted/],
  ] as const)
    await assert.rejects(
      host.resolveProfile({ parentId: "x", profile: name }),
      reason,
    );
  assert.deepEqual(await host.usableProfiles("x"), ["ok"]);
});

void test("initializeChild writes capabilities and a compaction override unless inherit", async () => {
  const { host, initialized } = setup([
    profile("inherit"),
    profile("tight", {
      compaction: { profile: "balanced", triggerPercent: 70 },
    }),
  ]);
  await (
    await host.resolveProfile({ parentId: "x", profile: "inherit" })
  ).initializeChild("c1");
  assert.deepEqual(initialized, ["c1"]);
  await (
    await host.resolveProfile({ parentId: "x", profile: "tight" })
  ).initializeChild("c2");
  assert.deepEqual(initialized[2], [
    "c2",
    {
      auto: true,
      profile: "balanced",
      customTriggerPercent: 70,
    },
  ]);
});

void test("initialization uses the resolved snapshot after a concurrent edit or deletion", async () => {
  const original = profile("snapshot", {
    tools: { web_fetch: false },
    compaction: { profile: "balanced", triggerPercent: 70 },
  });
  const profiles = [original];
  const { host, initialized, capabilitySnapshots } = setup(profiles);
  const resolved = await host.resolveProfile({
    parentId: "x",
    profile: "snapshot",
  });
  original.compaction = "inherit";
  original.permission = "autonomous";
  original.tools.web_fetch = true;
  profiles.length = 0;
  await resolved.initializeChild("child");
  assert.equal(resolved.config.permissionRuleSetId, "read_only");
  assert.equal(capabilitySnapshots[0].tools.web_fetch, false);
  assert.equal(
    (initialized[1] as [string, { customTriggerPercent: number }])[1]
      .customTriggerPercent,
    70,
  );
});
