import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCapabilityPatch,
  emptyCapabilityOverrides,
  normalizeCapabilityOverrides,
  resolveCapabilitySelection,
  capabilityToolSettingsFromSettings,
  type CapabilitySelection,
} from "../../src/domains/capabilities/capabilities.js";
import { defaultSettings } from "../../src/domains/settings/settings.js";

test("whole tool payloads stay pinned across parent changes and normalize away only on editing", () => {
  const user: CapabilitySelection = {
    disabledTools: [],
    toolProfiles: { web_search: "user" },
    toolSettings: capabilityToolSettingsFromSettings(defaultSettings),
    disabledFileSkills: [],
    enabledNerveSkills: [],
    enabledAgentBrowserSkills: [],
  };
  const document = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    {
      tools: {
        web_search: { enabled: false, profileId: "selected" },
        python_exec: { settings: { interpreterPath: "/chosen/python" } },
      },
    },
    user,
  );
  const changed = { ...user, toolProfiles: { web_search: "changed" } };
  assert.equal(
    resolveCapabilitySelection({ user: changed, conversation: document })
      .toolProfiles.web_search,
    "selected",
  );
  assert.equal(document.tools.web_search?.profileId, "selected");
  const matching = resolveCapabilitySelection({ user, conversation: document });
  assert.deepEqual(
    normalizeCapabilityOverrides(document, matching),
    emptyCapabilityOverrides(),
  );
});
