import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyCapabilityOverrides,
  type CapabilityConfiguration,
  type CapabilitySelection,
} from "@nervekit/contracts/capabilities";
import {
  capabilityOriginLabel,
  capabilityTogglePatch,
  capabilityToolState,
} from "./capability-origin";

const selection = (
  overrides: Partial<CapabilitySelection> = {},
): CapabilitySelection => ({
  disabledTools: [],
  toolProfiles: {},
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
});
