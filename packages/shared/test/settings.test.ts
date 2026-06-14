import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSettings, settingsSchema } from "../src/index.js";

describe("settings schema", () => {
  it("fills new-agent model and last-selection defaults", () => {
    const settings = settingsSchema.parse(defaultSettings);

    assert.equal(settings.defaultThinkingLevel, "off");
    assert.equal(settings.defaultModel, undefined);
    assert.equal(settings.rememberLastAgentSelection, false);
    assert.deepEqual(settings.lastAgentSelection, {
      mode: "coding",
      permissionLevel: "autonomous",
      thinkingLevel: "off",
    });
  });

  it("backfills new defaults for older config files", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      defaultThinkingLevel: undefined,
      rememberLastAgentSelection: undefined,
      lastAgentSelection: undefined,
    });

    assert.equal(settings.defaultThinkingLevel, "off");
    assert.equal(settings.rememberLastAgentSelection, false);
    assert.equal(settings.lastAgentSelection.mode, "coding");
    assert.equal(settings.lastAgentSelection.permissionLevel, "autonomous");
    assert.equal(settings.lastAgentSelection.thinkingLevel, "off");
  });
});
