import { subagentToolNames } from "../../src/domains/tools/subagent-tools.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autoCompactionSettingsSchema,
  colorThemeKind,
  colorThemeSchema,
  darkColorThemes,
  defaultDarkColorTheme,
  defaultLightColorTheme,
  legacyColorThemes,
  lightColorThemes,
  defaultUiConfig,
  uiConfigSchema,
  defaultSettings,
  settingsSchema,
  updateApplicationConfigurationRequestSchema,
  updateSettingsRequestSchema,
} from "../../src/domains/settings/index.js";

describe("settings schema", () => {
  it("classifies every colour theme as light or dark and maps legacy ids to a pair", () => {
    assert.deepEqual(
      [...lightColorThemes, ...darkColorThemes].sort(),
      [...colorThemeSchema.options].sort(),
    );
    assert.equal(colorThemeKind[defaultLightColorTheme], "light");
    assert.equal(colorThemeKind[defaultDarkColorTheme], "dark");
    for (const pair of Object.values(legacyColorThemes)) {
      assert.equal(colorThemeKind[pair.light], "light");
      assert.equal(colorThemeKind[pair.dark], "dark");
    }
  });

  it("keeps only zoom in daemon appearance and drops client preference patches", () => {
    assert.deepEqual(defaultSettings.ui, { zoomLevel: 0 });
    assert.deepEqual(defaultUiConfig.appearance, { zoomLevel: 0 });
    for (const field of ["theme", "colorMode"]) {
      assert.equal(
        uiConfigSchema.safeParse({
          ...defaultUiConfig,
          appearance: { zoomLevel: 0, [field]: "dark" },
        }).success,
        false,
      );
      assert.deepEqual(
        updateSettingsRequestSchema.parse({ ui: { [field]: "dark" } }).ui,
        {},
      );
    }
  });
  it("normalizes a partially disabled sub-agent group to fully disabled", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      tools: { ...defaultSettings.tools, disabled: ["subagent_prompt"] },
    });
    assert.deepEqual(
      new Set(settings.tools.disabled),
      new Set(subagentToolNames),
    );
  });

  it("maps removed legacy tool names when reading disabled lists", () => {
    const parse = (disabled: string[]) =>
      settingsSchema.parse({
        ...defaultSettings,
        tools: { ...defaultSettings.tools, disabled },
      }).tools.disabled;
    assert.deepEqual(
      new Set(parse(["subagent_new"])),
      new Set(subagentToolNames),
    );
    assert.deepEqual(
      new Set(parse(["subagent_list", "web_fetch"])),
      new Set([...subagentToolNames, "web_fetch"]),
    );
    assert.deepEqual(parse(["explore", "web_fetch"]), ["web_fetch"]);
  });

  it("adds automatic resource defaults to older persisted application settings", () => {
    const legacy = structuredClone(defaultSettings);
    const application: Record<string, unknown> = { ...legacy.application };
    delete application.resources;
    const parsed = settingsSchema.parse({ ...legacy, application });
    assert.equal(parsed.application.resources.mode, "automatic");
    assert.equal(parsed.application.resources.maxConcurrentModelRuns, 10);
  });

  it("reads legacy low daemon heaps but rejects new unsafe updates", () => {
    const legacy = structuredClone(defaultSettings);
    legacy.application.daemon.maxOldSpaceMb = 128;
    assert.equal(
      settingsSchema.parse(legacy).application.daemon.maxOldSpaceMb,
      128,
    );
    assert.equal(
      updateApplicationConfigurationRequestSchema.safeParse({
        application: { daemon: { maxOldSpaceMb: 128 } },
      }).success,
      false,
    );
  });

  it("rejects incomplete persisted settings", () => {
    assert.equal(
      settingsSchema.safeParse({
        defaultMode: "coding",
        defaultPermissionRuleSetId: "autonomous",
      }).success,
      false,
    );
  });

  it("validates bounded permission exceptions", () => {
    const patch = updateSettingsRequestSchema.parse({
      permissions: {
        exceptions: [
          {
            id: "exception_datadog",
            tool: "bash",
            effect: "allow",
            rule: "datadog logs read*",
          },
          {
            id: "exception_secrets",
            tool: "read",
            effect: "deny",
            rule: "secrets/**",
          },
        ],
      },
    });
    assert.equal(patch.permissions?.exceptions?.length, 2);
    assert.throws(() =>
      updateSettingsRequestSchema.parse({
        permissions: {
          exceptions: [
            {
              id: "exception_python",
              tool: "unknown_tool",
              effect: "allow",
              rule: "*",
            },
          ],
        },
      }),
    );
  });

  it("rejects duplicate profile ids", () => {
    assert.equal(
      settingsSchema.safeParse({
        ...defaultSettings,
        providers: {
          atlassianProfiles: [
            { id: "duplicate", name: "One" },
            { id: "duplicate", name: "Two" },
          ],
          tavilyProfiles: [],
        },
      }).success,
      false,
    );
  });

  it("rejects migrated agent and creation fields in the preserved settings update API", () => {
    for (const patch of [
      { defaultAgentProfile: "coding" },
      { defaultModel: null },
      { compaction: {} },
      { retry: {} },
      { skills: {} },
      { tools: {} },
      { scopedModels: [] },
    ]) {
      assert.equal(updateSettingsRequestSchema.safeParse(patch).success, false);
    }
  });
  it("rejects obsolete harness retention fields instead of silently stripping them", () => {
    assert.equal(
      autoCompactionSettingsSchema.safeParse(defaultSettings.compaction)
        .success,
      true,
    );
    assert.equal(
      autoCompactionSettingsSchema.safeParse({
        ...defaultSettings.compaction,
        customKeepRecentPercent: 15,
      }).success,
      false,
    );
  });
});
