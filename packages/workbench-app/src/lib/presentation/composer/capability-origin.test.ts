import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capabilityToolSettingsFromSettings,
  emptyCapabilityOverrides,
  type CapabilityConfiguration,
  type CapabilitySelection,
} from "@nervekit/contracts/capabilities";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  capabilityOriginLabel,
  capabilityResetPatch,
  capabilityTogglePatch,
  capabilityToolState,
} from "./capability-origin";

const selection = (
  overrides: Partial<CapabilitySelection> = {},
): CapabilitySelection => ({
  disabledTools: [],
  toolProfiles: {},
  toolSettings: capabilityToolSettingsFromSettings(defaultSettings),
  disabledFileSkills: [],
  enabledNerveSkills: [],
  enabledAgentBrowserSkills: [],
  ...overrides,
});

function configuration(
  input: Partial<CapabilityConfiguration> = {},
): CapabilityConfiguration {
  return {
    project: emptyCapabilityOverrides(),
    conversation: emptyCapabilityOverrides(),
    inherited: selection(),
    effective: selection(),
    availableTools: ["jira", "web_search", "web_fetch"],
    toolProfileOptions: {
      jira: [{ id: "ner", name: "NER" }],
      confluence: [],
      web_search: [],
    },
    trust: {
      status: "trusted",
      digest: "d",
      trustedDigest: "d",
      trustedAt: "2026-10-01T00:00:00.000Z",
    },
    ...input,
  };
}

describe("capabilityOriginLabel", () => {
  it("distinguishes inherited, overridden, and stored-but-equal values", () => {
    const base = {
      level: "conversation" as const,
      inheritedFrom: "project" as const,
    };
    assert.equal(
      capabilityOriginLabel({ ...base, stored: false, matchesInherited: true }),
      "Inherited from project settings",
    );
    assert.equal(
      capabilityOriginLabel({ ...base, stored: true, matchesInherited: false }),
      "Set in this conversation",
    );
    assert.equal(
      capabilityOriginLabel({ ...base, stored: true, matchesInherited: true }),
      "Set in this conversation · same as project",
    );
    assert.equal(
      capabilityOriginLabel({
        level: "project",
        inheritedFrom: "user",
        stored: false,
        matchesInherited: true,
      }),
      "Inherited from your settings",
    );
  });
});

describe("capabilityToolState", () => {
  it("keeps a stored conversation value marked after the project matches it", () => {
    const state = capabilityToolState({
      configuration: configuration({
        project: {
          ...emptyCapabilityOverrides(),
          tools: { jira: { enabled: true } },
        },
        conversation: {
          ...emptyCapabilityOverrides(),
          tools: { jira: { enabled: true } },
        },
      }),
      level: "conversation",
      names: ["jira"],
    });
    assert.equal(state.stored, true);
    assert.equal(state.matchesInherited, true);
    assert.equal(
      state.originLabel,
      "Set in this conversation · same as project",
    );
  });

  it("flags enabled integrations without a usable profile", () => {
    const missing = capabilityToolState({
      configuration: configuration({
        effective: selection({ toolProfiles: { jira: "gone" } }),
      }),
      level: "conversation",
      names: ["jira"],
    });
    assert.equal(missing.profileMissing, true);
    assert.equal(missing.needsProfile, true);

    const web = capabilityToolState({
      configuration: configuration(),
      level: "conversation",
      names: ["web_search", "web_fetch"],
    });
    assert.equal(web.profileTool, "web_search");
    assert.equal(web.needsProfile, false);
  });

  it("selects the only profile when enabling an integration", () => {
    const state = capabilityToolState({
      configuration: configuration({
        effective: selection({ disabledTools: ["jira"] }),
      }),
      level: "conversation",
      names: ["jira"],
    });
    assert.deepEqual(capabilityTogglePatch(state, ["jira"], true), {
      jira: { enabled: true, profileId: "ner" },
    });
    assert.deepEqual(capabilityTogglePatch(state, ["jira"], false), {
      jira: { enabled: false },
    });
  });

  it("treats a conversation's tool settings as an override of that tool", () => {
    const inherited = selection();
    const model = { provider: "openai", modelId: "gpt-5.1-mini" };
    const state = capabilityToolState({
      configuration: configuration({
        availableTools: ["explore"],
        conversation: {
          ...emptyCapabilityOverrides(),
          toolSettings: { explore: { model, thinkingLevel: "high" } },
        },
        effective: selection({
          toolSettings: {
            ...inherited.toolSettings,
            explore: { model, thinkingLevel: "high" },
          },
        }),
      }),
      level: "conversation",
      names: ["explore"],
    });
    assert.equal(state.settingsTool, "explore");
    assert.equal(state.stored, true);
    assert.equal(state.matchesInherited, false);
    assert.equal(state.originLabel, "Set in this conversation");
  });

  it("attributes inherited tool settings to a trusted project", () => {
    const state = capabilityToolState({
      configuration: configuration({
        project: {
          ...emptyCapabilityOverrides(),
          toolSettings: { kroki_export: { url: "http://kroki.internal/" } },
        },
      }),
      level: "conversation",
      names: ["kroki_export"],
    });
    assert.equal(state.stored, false);
    assert.equal(state.inheritedFrom, "project");
  });

  it("resets enablement, profile, and settings of a tool group together", () => {
    assert.deepEqual(capabilityResetPatch(["explore"]), {
      tools: { explore: { enabled: null } },
      toolSettings: { explore: null },
    });
    assert.deepEqual(capabilityResetPatch(["web_search", "web_fetch"]), {
      tools: {
        web_search: { enabled: null, profileId: null },
        web_fetch: { enabled: null },
      },
    });
  });
});
