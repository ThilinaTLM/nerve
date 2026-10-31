import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultSettings,
  settingsSchema,
  updateSettingsRequestSchema,
} from "../../src/domains/settings/settings.js";
import {
  defaultUiConfig,
  uiConfigSchema,
} from "../../src/domains/settings/home-configuration.js";

test("conversation titles are off with no model by default, including old settings", () => {
  assert.deepEqual(defaultSettings.conversationTitles, {
    enabled: false,
    model: null,
  });
  const old: Partial<typeof defaultSettings> = { ...defaultSettings };
  delete old.conversationTitles;
  assert.deepEqual(settingsSchema.parse(old).conversationTitles, {
    enabled: false,
    model: null,
  });
  const oldUi: Partial<typeof defaultUiConfig> = { ...defaultUiConfig };
  delete oldUi.conversationTitles;
  assert.deepEqual(uiConfigSchema.parse(oldUi).conversationTitles, {
    enabled: false,
    model: null,
  });
});
test("title selection stores a concrete provider and model", () => {
  assert.ok(
    updateSettingsRequestSchema.safeParse({
      conversationTitles: {
        enabled: true,
        model: { provider: "google", modelId: "gemini-2.5-flash-lite" },
      },
    }).success,
  );
  assert.equal(
    updateSettingsRequestSchema.safeParse({
      conversationTitles: {
        enabled: true,
        model: { provider: "", modelId: "x" },
      },
    }).success,
    false,
  );
});
