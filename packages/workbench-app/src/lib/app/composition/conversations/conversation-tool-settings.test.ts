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
  conversationProfileId,
  inheritedProfileLabel,
  modelToolSettingsPatch,
} from "./conversation-tool-settings";

const selection = (
  toolProfiles: CapabilitySelection["toolProfiles"] = {},
): CapabilitySelection => ({
  disabledTools: [],
  toolProfiles,
  toolSettings: capabilityToolSettingsFromSettings(defaultSettings),
  disabledFileSkills: [],
  enabledNerveSkills: [],
  enabledAgentBrowserSkills: [],
});

const configuration = (
  input: Partial<CapabilityConfiguration>,
): CapabilityConfiguration => ({
  project: emptyCapabilityOverrides(),
  inherited: selection(),
  effective: selection(),
  availableTools: ["jira"],
  toolProfileOptions: {
    jira: [{ id: "ner", name: "NER" }],
    confluence: [],
    web_search: [],
  },
  trust: { status: "missing" },
  ...input,
});

describe("conversation tool settings dialog", () => {
  it("selects the inherit choice until the conversation stores a profile", () => {
    const inheriting = configuration({
      inherited: selection({ jira: "ner" }),
      effective: selection({ jira: "ner" }),
    });
    assert.equal(conversationProfileId(inheriting, "jira"), undefined);
    assert.equal(
      inheritedProfileLabel(inheriting, "jira", "user"),
      "Use your settings (NER)",
    );

    const pinned = configuration({
      conversation: {
        ...emptyCapabilityOverrides(),
        tools: { jira: { profileId: "ner" } },
      },
    });
    assert.equal(conversationProfileId(pinned, "jira"), "ner");
    assert.equal(
      inheritedProfileLabel(pinned, "jira", "project"),
      "Use project (no profile)",
    );
  });

  it("stores model tools without an unset model", () => {
    assert.deepEqual(
      modelToolSettingsPatch("explore", { thinkingLevel: "off" }),
      { toolSettings: { explore: { thinkingLevel: "off" } } },
    );
    const model = { provider: "openai", modelId: "gpt-5.1" };
    assert.deepEqual(
      modelToolSettingsPatch("explain_image", { model, thinkingLevel: "low" }),
      { toolSettings: { explain_image: { model, thinkingLevel: "low" } } },
    );
  });
});
