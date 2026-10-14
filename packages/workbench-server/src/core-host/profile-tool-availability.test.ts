import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  builtInSubagentProfiles,
  type SubagentProfile,
} from "@nervekit/contracts/subagents";
import { userCapabilitySelection } from "./user-capability-selection.js";
import { profileToolAvailability } from "./profile-tool-availability.js";
import { createProfileAvailability } from "./subagent-profile-availability.js";

const profile: SubagentProfile = {
  ...builtInSubagentProfiles[0],
  source: "builtin",
  tools: { web_search: true },
  skills: "inherit",
};
const configuration = () => ({
  effective: userCapabilitySelection(defaultSettings),
  availableTools: [...capabilityToolNameSchema.options],
  toolProfileOptions: {
    jira: [{ id: "atlas", name: "Atlas" }],
    confluence: [{ id: "atlas", name: "Atlas" }],
    web_search: [{ id: "search", name: "Search" }],
  },
});

void test("configured integrations use canonical credential namespaces and remain available", async () => {
  const config = configuration();
  config.effective.toolProfiles = {
    web_search: "search",
    jira: "atlas",
    confluence: "atlas",
  };
  const keys: string[] = [];
  const available = await profileToolAvailability({
    profile,
    configuration: config,
    installed: new Set(["web_search", "jira", "confluence"]),
    credentialConfigured: async (key) => {
      keys.push(key);
      return ["tavily:search", "atlassian:atlas"].includes(key);
    },
    modelAvailable: async () => {},
  });
  assert.equal(available.get("web_search"), undefined);
  assert.equal(available.get("jira"), undefined);
  assert.equal(available.get("confluence"), undefined);
  assert.ok(keys.includes("tavily:search"));
  assert.ok(!keys.includes("search"));
});

void test("an unavailable image explanation override warns, not primary-model blocks", async () => {
  const config = configuration();
  config.effective.toolSettings.explain_image.model = {
    provider: "provider",
    modelId: "inherited",
  };
  const customized: SubagentProfile = {
    ...profile,
    tools: {
      explain_image: {
        model: { provider: "provider", modelId: "missing" },
        thinkingLevel: "off",
      },
    },
  };
  const selected: unknown[] = [];
  const resources = await profileToolAvailability({
    profile: customized,
    configuration: config,
    installed: new Set(["explain_image"]),
    credentialConfigured: async () => false,
    modelAvailable: async (model) => {
      selected.push(model);
      throw new Error("Unknown model");
    },
  });
  assert.deepEqual(selected, [{ provider: "provider", modelId: "missing" }]);
  const check = createProfileAvailability({
    parent: () => {
      throw new Error("No lead expected");
    },
    modelInfo: async () => {
      throw new Error("No primary model lookup expected");
    },
    resources: async () => ({ tools: resources, skills: new Map() }),
  });
  const diagnostics = await check(customized, {});
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "warning");
  assert.equal(diagnostics[0].reference, "explain_image");
  assert.match(diagnostics[0].message, /Unknown model/);
});
