import { builtInAgentProfiles } from "../domains/agent-profiles/builtin-agent-profiles.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  agentProfileSchema,
  type AgentProfile,
} from "@nervekit/contracts/agent-profiles";
import { userCapabilitySelection } from "./user-capability-selection.js";
import { profileToolAvailability } from "./profile-tool-availability.js";
import { createProfileAvailability } from "./agent-profile-availability.js";

const profile: AgentProfile = agentProfileSchema.parse({
  ...builtInAgentProfiles[0],
  source: "builtin",
  tools: { web_search: { set: { enabled: true } } },
});
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
  const customized: AgentProfile = {
    ...profile,
    tools: {
      explain_image: {
        set: {
          settings: {
            model: { provider: "provider", modelId: "missing" },
            thinkingLevel: "off",
          },
        },
      },
    },
  };
  const selected: unknown[] = [];
  const resources = await profileToolAvailability({
    profile: customized,
    configuration: config,
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

void test("Planning's core-provided plan_present is available without local tool definitions", async () => {
  const planning = agentProfileSchema.parse({
    ...builtInAgentProfiles.find((profile) => profile.name === "planning")!,
    source: "builtin",
  });
  const resources = await profileToolAvailability({
    profile: planning,
    configuration: configuration(),
    credentialConfigured: async () => false,
    modelAvailable: async () => {},
  });
  assert.ok(resources.has("plan_present"));
  assert.equal(resources.get("plan_present"), undefined);
  const check = createProfileAvailability({
    parent: () => {
      throw new Error("No parent expected");
    },
    modelInfo: async () => {
      throw new Error("No model lookup expected");
    },
    resources: async () => ({ tools: resources, skills: new Map() }),
  });
  assert.deepEqual(await check(planning, {}), []);
});
