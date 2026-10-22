import assert from "node:assert/strict";
import { test } from "node:test";
import { agentProfileSchema } from "@nervekit/contracts/agent-profiles";
import type { AgentModelInfo } from "@nervekit/harness/models";
import { createProfileAvailability } from "./agent-profile-availability.js";

void test("portable unavailable resources warn using neutral profile wording without duplicate unknown-tool warnings", async () => {
  const check = createProfileAvailability({
    parent: () => {
      throw new Error("No saved parent");
    },
    modelInfo: async () => {
      throw new Error("No model");
    },
    resources: async () => ({
      tools: new Map([["web_search", "Missing credentials"]]),
      skills: new Map(),
    }),
  });
  for (const usableBy of ["lead", "subagent", "both"] as const) {
    const profile = agentProfileSchema.parse({
      name: "review",
      description: "Review",
      label: "Review",
      enabled: true,
      usableBy,
      source: "user",
      tools: {
        web_search: { set: { enabled: true } },
        web_fetch: { set: { enabled: false } },
      },
      skills: { set: { file: { missing: true }, nerve: {}, agentBrowser: {} } },
      instructions: "",
    });
    const diagnostics = await check(profile, {});
    assert.deepEqual(
      diagnostics.map((d) => [d.severity, d.reference]),
      [
        ["warning", "web_search"],
        ["warning", "missing"],
      ],
    );
    for (const diagnostic of diagnostics) {
      assert.match(diagnostic.message, /for this profile/);
      assert.doesNotMatch(diagnostic.message, /sub-agent/);
    }
  }
});

void test("model and thinking resolve independently, including explicit lead context", async () => {
  const selections: unknown[] = [];
  const check = createProfileAvailability({
    parent: () => {
      throw new Error("Draft must not load saved parent");
    },
    modelInfo: async (selection) => {
      selections.push(selection);
      return { supportedThinkingLevels: ["off"] } as AgentModelInfo;
    },
    resources: async () => ({ tools: new Map(), skills: new Map() }),
  });
  const profile = agentProfileSchema.parse({
    name: "review",
    description: "Review",
    label: "Review",
    enabled: true,
    usableBy: "subagent",
    source: "user",
    tools: {},
    instructions: "",
    model: "lead",
    thinking: "lead",
  });
  const diagnostics = await check(profile, {
    lead: {
      model: { provider: "test", modelId: "draft" },
      reasoningLevel: "high",
    },
  });
  assert.deepEqual(selections, [{ provider: "test", modelId: "draft" }]);
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].code, "unsupported_thinking");
  assert.equal(diagnostics[0].reference, "high");
});
