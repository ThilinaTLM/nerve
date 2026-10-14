import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationConfig } from "@nervekit/contracts/core";
import type { SubagentProfile } from "@nervekit/contracts/subagents";
import type { AgentModelInfo } from "@nervekit/harness/models";
import {
  availableProfileSnapshot,
  createProfileAvailability,
} from "./subagent-profile-availability.js";

const profile = (patch: Partial<SubagentProfile> = {}): SubagentProfile => ({
  name: "review",
  label: "Review",
  description: "Review code",
  source: "user",
  enabled: true,
  model: "lead",
  thinking: "lead",
  instructions: "",
  permission: "read_only",
  compaction: "inherit",
  tools: {},
  skills: "inherit",
  ...patch,
});
const lead = {
  model: { provider: "provider", modelId: "lead" },
  reasoningLevel: "high",
} as ConversationConfig;
const info = { supportedThinkingLevels: ["off", "high"] } as AgentModelInfo;

void test("missing resources warn without erasing portable preferences or duplicating unknown-tool warnings", async () => {
  const check = createProfileAvailability({
    parent: () => lead,
    modelInfo: async () => info,
    resources: async () => ({
      tools: new Map([["web_search", "Integration credentials missing"]]),
      skills: new Map(),
    }),
  });
  const original = profile({
    tools: { future_tool: true, web_search: true, web_fetch: false },
    skills: { missing: true, disabled: false },
  });
  const diagnostics = await check(original, {});
  assert.deepEqual(
    diagnostics.map((d) => [d.severity, d.field, d.reference]),
    [
      ["warning", "tools", "web_search"],
      ["warning", "skills", "missing"],
    ],
  );
  const snapshot = availableProfileSnapshot(original, diagnostics);
  assert.equal(snapshot.tools.web_search, false);
  assert.deepEqual(snapshot.skills, { missing: false, disabled: false });
  assert.equal(original.tools.web_search, true);
  assert.deepEqual(original.skills, { missing: true, disabled: false });
});

void test("explicit unavailable model is blocking even without a lead or project", async () => {
  const check = createProfileAvailability({
    parent: () => {
      throw new Error("No parent expected");
    },
    modelInfo: async () => {
      throw new Error("Configure provider credentials");
    },
    resources: async () => ({ tools: new Map(), skills: new Map() }),
  });
  const diagnostics = await check(
    profile({ model: "provider/unavailable" }),
    {},
  );
  assert.equal(diagnostics[0]?.code, "unavailable_model");
  assert.equal(diagnostics[0]?.severity, "blocking");
  assert.match(diagnostics[0].message, /Configure provider credentials/);
});

void test("thinking compatibility uses the selected model and current parent thinking without downgrading", async () => {
  const selected: unknown[] = [];
  const check = createProfileAvailability({
    parent: () => lead,
    modelInfo: async (model) => {
      selected.push(model);
      return { ...info, supportedThinkingLevels: ["off"] };
    },
    resources: async () => ({ tools: new Map(), skills: new Map() }),
  });
  const original = profile({ model: "provider/plain" });
  const diagnostics = await check(original, {
    projectId: "p",
    conversationId: "lead",
  });
  assert.deepEqual(selected, [{ provider: "provider", modelId: "plain" }]);
  assert.equal(diagnostics[0]?.code, "unsupported_thinking");
  assert.equal(diagnostics[0]?.reference, "high");
  assert.equal(original.thinking, "lead");
  assert.deepEqual(
    await check(profile({ thinking: "off" }), { conversationId: "lead" }),
    [],
  );
});

void test("draft lead context validates inherited model and thinking without loading a saved parent", async () => {
  const selected: unknown[] = [];
  const check = createProfileAvailability({
    parent: () => {
      throw new Error("Draft must not load a parent");
    },
    modelInfo: async (model) => {
      selected.push(model);
      return { ...info, supportedThinkingLevels: ["off"] };
    },
    resources: async () => ({ tools: new Map(), skills: new Map() }),
  });
  const diagnostics = await check(profile(), {
    projectId: "proj_one",
    lead: { model: lead.model, reasoningLevel: "high" },
  });
  assert.deepEqual(selected, [lead.model]);
  assert.equal(diagnostics[0]?.code, "unsupported_thinking");
  assert.deepEqual(
    await check(profile(), {
      lead: { model: lead.model, reasoningLevel: "off" },
    }),
    [],
  );
});
