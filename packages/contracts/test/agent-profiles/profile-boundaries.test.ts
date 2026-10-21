import assert from "node:assert/strict";
import test from "node:test";
import { coreOperationSchemas } from "../../src/domains/core/core-operations.js";
import { conversationConfigSchema } from "../../src/domains/core/conversation.js";
import {
  settingsSchema,
  defaultSettings,
  updateSettingsRequestSchema,
} from "../../src/domains/settings/settings.js";
import {
  harnessConfigSchema,
  defaultHarnessConfig,
} from "../../src/domains/settings/home-configuration.js";
import { capabilityToolNameSchema } from "../../src/domains/capabilities/capabilities.js";
import { DEFAULT_AGENT_PROFILE } from "../../src/domains/agent-profiles/index.js";

test("active profiles are named configs, switched through the dedicated user operation", () => {
  const operation = coreOperationSchemas["conversation.setAgentProfile"];
  assert.deepEqual(
    operation.params.parse({ conversationId: "c", profile: "my-profile" }),
    { conversationId: "c", profile: "my-profile" },
  );
  assert.equal(
    operation.params.safeParse({ conversationId: "c", profile: "Bad Name" })
      .success,
    false,
  );
  const config = {
    conversationId: "c",
    agentProfile: "my-profile",
    model: { provider: "p", modelId: "m" },
    reasoningLevel: "off",
    systemPrompt: null,
    instructions: null,
    permissionRuleSetId: "autonomous",
    workingDirectory: "/tmp",
  };
  assert.deepEqual(operation.result.parse(config), config);
  const withoutProfile: Partial<typeof config> = { ...config };
  delete withoutProfile.agentProfile;
  assert.equal(
    conversationConfigSchema.safeParse({ ...withoutProfile, mode: "coding" })
      .success,
    false,
  );
  assert.deepEqual(
    coreOperationSchemas["conversation.configure"].params.parse({
      conversationId: "c",
      patch: { agentProfile: "planning" },
    }).patch,
    {},
  );
});

test("default profile is optional in resolved settings and user/project harness documents", () => {
  assert.equal(DEFAULT_AGENT_PROFILE, "coding");
  assert.equal(
    settingsSchema.parse(defaultSettings).defaultAgentProfile,
    undefined,
  );
  assert.equal(
    settingsSchema.parse({ ...defaultSettings, defaultAgentProfile: "my-lead" })
      .defaultAgentProfile,
    "my-lead",
  );
  assert.deepEqual(
    updateSettingsRequestSchema.parse({ defaultAgentProfile: "planning" }),
    { defaultAgentProfile: "planning" },
  );
  assert.equal(
    harnessConfigSchema.parse(defaultHarnessConfig).defaultAgentProfile,
    undefined,
  );
  assert.equal(
    harnessConfigSchema.parse({
      ...defaultHarnessConfig,
      defaultAgentProfile: "planning",
    }).defaultAgentProfile,
    "planning",
  );
});

test("plan_present is a capability tool disabled in built-in settings", () => {
  assert.equal(capabilityToolNameSchema.parse("plan_present"), "plan_present");
  assert.ok(defaultSettings.tools.disabled.includes("plan_present"));
});
