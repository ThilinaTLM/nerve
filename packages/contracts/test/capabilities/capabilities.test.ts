import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCapabilityPatch,
  capabilityOverridesDocumentSchema,
  capabilityPatchSchema,
  capabilityToolSettingsFromSettings,
  emptyCapabilityOverrides,
  resolveCapabilitySelection,
  capabilityToolsFromDisabledNames,
  disabledToolNamesForCapabilities,
  type CapabilitySelection,
} from "../../src/domains/capabilities/capabilities.js";
import { defaultSettings } from "../../src/domains/settings/settings.js";
const user: CapabilitySelection = {
  disabledTools: ["python_exec"],
  toolProfiles: { web_search: "user-account" },
  toolSettings: capabilityToolSettingsFromSettings(defaultSettings),
  disabledFileSkills: [],
  enabledNerveSkills: [],
  enabledAgentBrowserSkills: [],
};

test("typed tool payloads and skills compose across all scoped settings layers", () => {
  const project = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 3,
    tools: {
      python_exec: {
        enabled: true,
        settings: { interpreterPath: "/project/python" },
      },
      web_search: { profileId: "project-account" },
      bash: {
        settings: {
          maxTimeoutMs: 5000,
          autoPromotion: { enabled: false, afterMs: 2000 },
          shellPath: "/bin/sh",
        },
      },
    },
    skills: {
      file: { private: false },
      nerve: { planning: true },
      agentBrowser: {},
    },
  });
  const conversation = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 3,
    tools: {
      python_exec: { settings: { interpreterPath: "/conversation/python" } },
      web_search: { enabled: false },
      plan_present: { enabled: true, settings: { approvalProfile: "coding" } },
    },
  });
  const effective = resolveCapabilitySelection({ user, project, conversation });
  assert.equal(effective.disabledTools.includes("python_exec"), false);
  assert.equal(effective.disabledTools.includes("web_search"), true);
  assert.equal(effective.toolProfiles.web_search, "project-account");
  assert.equal(
    effective.toolSettings.python_exec.interpreterPath,
    "/conversation/python",
  );
  assert.equal(effective.toolSettings.bash.shellPath, "/bin/sh");
  assert.equal(effective.toolSettings.plan_present.approvalProfile, "coding");
  assert.deepEqual(effective.disabledFileSkills, ["private"]);
  assert.deepEqual(effective.enabledNerveSkills, ["planning"]);
});

test("core tools cannot toggle and account/config fields are validated for their owning tool", () => {
  for (const tools of [
    { read: { enabled: false } },
    { edit: { enabled: false } },
    { ask_user: { enabled: false } },
    { bash: { enabled: false } },
    { web_fetch: { profileId: "account" } },
    { web_search: { settings: { interpreterPath: "x" } } },
    { python_exec: { settings: { approvalProfile: "coding" } } },
    { plan_present: { settings: { approvalProfile: "../coding" } } },
    { future: { enabled: true } },
    { web_fetch: {} },
  ])
    assert.equal(
      capabilityOverridesDocumentSchema.safeParse({ schemaVersion: 3, tools })
        .success,
      false,
      JSON.stringify(tools),
    );
  assert.equal(
    capabilityPatchSchema.safeParse({ tools: { bash: { enabled: null } } })
      .success,
    false,
  );
  assert.equal(
    capabilityPatchSchema.safeParse({
      tools: { web_fetch: { profileId: null } },
    }).success,
    false,
  );
  assert.equal(
    capabilityPatchSchema.safeParse({
      tools: { python_exec: { settings: { interpreterPath: "/python" } } },
    }).success,
    true,
  );
});

test("legacy documents and detached settings require migration, never a runtime dual reader", () => {
  for (const input of [
    { schemaVersion: 1, tools: { web_search: true } },
    { schemaVersion: 2, tools: { web_search: { enabled: true } } },
    {
      schemaVersion: 3,
      toolSettings: { python_exec: { interpreterPath: "x" } },
    },
  ])
    assert.equal(
      capabilityOverridesDocumentSchema.safeParse(input).success,
      false,
    );
});

test("payload field and whole entry resets return to inherited values without mutating inputs", () => {
  const document = emptyCapabilityOverrides();
  const edited = applyCapabilityPatch(
    document,
    {
      tools: {
        web_search: { profileId: "conversation-account", enabled: false },
        python_exec: {
          enabled: true,
          settings: { interpreterPath: "/python" },
        },
      },
    },
    user,
  );
  assert.deepEqual(document, emptyCapabilityOverrides());
  const resetAccount = applyCapabilityPatch(
    edited,
    { tools: { web_search: { profileId: null } } },
    user,
  );
  assert.equal(resetAccount.tools.web_search?.profileId, "user-account");
  assert.equal(resetAccount.tools.web_search?.enabled, false);
  const reset = applyCapabilityPatch(
    resetAccount,
    { tools: { web_search: null, python_exec: null } },
    user,
  );
  assert.deepEqual(reset, emptyCapabilityOverrides());
});

test("sub-agent runtime tools remain one optional capability", () => {
  assert.deepEqual(capabilityToolsFromDisabledNames(["subagent_prompt"]), [
    "subagents",
  ]);
  assert.ok(
    disabledToolNamesForCapabilities(["subagents"]).includes("subagent_prompt"),
  );
  assert.deepEqual(disabledToolNamesForCapabilities(["bash"]), []);
});
