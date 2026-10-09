import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../../src/domains/settings/settings.js";
import {
  applyCapabilityPatch,
  capabilityToolSettingsFromSettings,
  emptyCapabilityOverrides,
  normalizeCapabilityOverrides,
  resolveCapabilitySelection,
  type CapabilitySelection,
} from "../../src/domains/capabilities/capabilities.js";

test("whole tool entries survive parent changes and matching entries normalize away", () => {
  const user: CapabilitySelection = {
    disabledTools: ["jira"],
    toolProfiles: { jira: "A" },
    toolSettings: capabilityToolSettingsFromSettings(defaultSettings),
    disabledFileSkills: [],
    enabledNerveSkills: [],
    enabledAgentBrowserSkills: [],
  };
  const project = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    { tools: { jira: { enabled: true } } },
    user,
  );
  const inherited = resolveCapabilitySelection({ user, project });
  const conversation = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    {
      tools: { jira: { profileId: "B" } },
      skills: { file: { research: false } },
    },
    inherited,
  );
  assert.deepEqual(conversation.tools.jira, { enabled: true, profileId: "B" });
  assert.equal(
    resolveCapabilitySelection({
      user: { ...inherited, disabledTools: ["jira"] },
      conversation,
    }).disabledTools.includes("jira"),
    false,
  );
  assert.deepEqual(
    applyCapabilityPatch(
      conversation,
      { tools: { jira: { profileId: "A" } } },
      inherited,
    ).tools,
    {},
  );
  assert.deepEqual(normalizeCapabilityOverrides(project, inherited).tools, {});
  assert.deepEqual(
    resolveCapabilitySelection({ user: inherited, conversation })
      .disabledFileSkills,
    ["research"],
  );
});
