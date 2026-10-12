import { subagentToolNames } from "../../src/domains/tools/subagent-tools.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultHarnessConfig,
  defaultSettings,
  harnessConfigSchema,
  settingsSchema,
  updateApplicationConfigurationRequestSchema,
  updateSettingsRequestSchema,
} from "../../src/domains/settings/index.js";

describe("settings schema", () => {
  it("defaults and bounds the foreground bash timeout setting", () => {
    assert.equal(defaultSettings.tools.bash.maxTimeoutMs, 900_000);
    for (const maxTimeoutMs of [1000, 3_600_000]) {
      assert.equal(
        updateSettingsRequestSchema.safeParse({
          tools: { bash: { maxTimeoutMs } },
        }).success,
        true,
      );
    }
    for (const maxTimeoutMs of [999, 3_600_001, 1000.5]) {
      assert.equal(
        updateSettingsRequestSchema.safeParse({
          tools: { bash: { maxTimeoutMs } },
        }).success,
        false,
      );
    }
    const settings = settingsSchema.parse({
      ...defaultSettings,
      tools: {
        ...defaultSettings.tools,
        bash: { autoPromotion: { enabled: true, afterMs: 120_000 } },
      },
    });
    assert.equal(settings.tools.bash.maxTimeoutMs, 900_000);
  });
  it("validates only the current harness version and preserves explicit enablement", () => {
    assert.equal(
      harnessConfigSchema.safeParse({ ...defaultHarnessConfig, version: 2 })
        .success,
      false,
    );
    const enabled = harnessConfigSchema.parse({
      ...defaultHarnessConfig,
      tools: { ...defaultHarnessConfig.tools, disabled: [] },
    });
    assert.deepEqual(enabled.tools.disabled, []);
    assert.deepEqual(harnessConfigSchema.parse(enabled), enabled);
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
    assert.deepEqual(
      harnessConfigSchema.parse({
        ...defaultHarnessConfig,
        tools: { ...defaultHarnessConfig.tools, disabled: ["subagent_list"] },
      }).tools.disabled,
      [...subagentToolNames],
    );
  });

  it("no longer carries Explore or async sub-agent settings", () => {
    assert.equal("exploreAgent" in defaultSettings, false);
    assert.equal("asyncSubagent" in defaultSettings, false);
    assert.equal("exploreAgent" in defaultHarnessConfig, false);
    assert.equal("asyncSubagent" in defaultHarnessConfig, false);
    assert.equal(
      harnessConfigSchema.safeParse({
        ...defaultHarnessConfig,
        asyncSubagent: {},
      }).success,
      false,
    );
    assert.deepEqual(
      updateSettingsRequestSchema.parse({
        exploreAgent: {},
        asyncSubagent: {},
      }),
      {},
    );
  });

  it("defaults newly added Nerve skill settings in older harness files", () => {
    const legacy = structuredClone(defaultHarnessConfig) as Record<
      string,
      unknown
    >;
    const skills = { ...(legacy.skills as Record<string, unknown>) };
    delete skills.nerve;
    legacy.skills = skills;

    const parsed = harnessConfigSchema.parse(legacy);

    assert.deepEqual(parsed.skills.nerve, { enabled: [] });
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

  it("accepts runtime and tool update settings", () => {
    const parsed = updateSettingsRequestSchema.parse({
      notifications: {
        systemEnabled: false,
        soundsEnabled: false,
        events: {
          question: "pop",
          approval: "signal",
          completed: "none",
        },
      },
      transcription: {
        model: "gpt-transcribe",
        languages: ["en", "zh-tw"],
        vocabulary: ["Nerve", "Codex CLI"],
      },
      runtime: {
        pythonExecutablePath: "/usr/bin/python3",
        shellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      },
      ui: {
        theme: "solar",
        colorMode: "dark",
      },
      desktop: { headerType: "macos" },
      skills: {
        disabled: ["diagram", "imagegen"],
        nerve: { enabled: ["skill-creator"] },
        agentBrowser: { enabled: ["core", "dogfood"] },
      },
      tools: {
        disabled: ["web_search", "web_fetch", "explain_image", "python_exec"],
        bash: {
          autoPromotion: { enabled: false, afterMs: 240_000 },
        },
        jira: { enabled: true, profileId: "work" },
        confluence: { enabled: true, profileId: "work" },
        web: { tavilyProfileId: "search" },
        imageExplanation: {
          model: { provider: "google", modelId: "gemini-2.5-flash" },
          thinkingLevel: "high",
        },
        imageGeneration: {
          provider: "openai-codex",
          model: "gpt-image-2.5-sunburst",
          options: {
            quality: "max",
            size: "2048x2048",
            background: "transparent",
          },
        },
      },
      providers: {
        atlassianProfiles: [
          {
            id: "work",
            name: "Work",
            siteUrl: "https://example.atlassian.net",
            email: "user@example.com",
            defaultProjectKey: "PROJ",
            defaultSpaceKey: "DEV",
          },
        ],
        tavilyProfiles: [{ id: "search", name: "Search" }],
      },
    });
    assert.deepEqual(parsed.notifications, {
      systemEnabled: false,
      soundsEnabled: false,
      events: {
        question: "pop",
        approval: "signal",
        completed: "none",
      },
    });
    for (const invalidTone of ["siren", "kenney-switch-20"]) {
      assert.equal(
        updateSettingsRequestSchema.safeParse({
          notifications: { events: { approval: invalidTone } },
        }).success,
        false,
      );
    }
    assert.deepEqual(parsed.transcription, {
      model: "gpt-transcribe",
      languages: ["en", "zh-tw"],
      vocabulary: ["Nerve", "Codex CLI"],
    });
    for (const transcription of [
      { model: "whisper-1" },
      { languages: ["english"] },
      { vocabulary: ["invalid<term"] },
    ]) {
      assert.equal(
        updateSettingsRequestSchema.safeParse({ transcription }).success,
        false,
      );
    }
    assert.deepEqual(parsed.ui, {
      theme: "solar",
      colorMode: "dark",
    });
    assert.deepEqual(parsed.desktop, { headerType: "macos" });
    assert.equal(
      updateSettingsRequestSchema.safeParse({
        desktop: { headerType: "beos" },
      }).success,
      false,
    );
    for (const ui of [{ theme: "unknown" }, { colorMode: "sepia" }]) {
      assert.equal(
        updateSettingsRequestSchema.safeParse({ ui }).success,
        false,
      );
    }
    assert.equal(parsed.runtime?.pythonExecutablePath, "/usr/bin/python3");
    assert.equal(
      parsed.runtime?.shellPath,
      "C:\\Program Files\\Git\\bin\\bash.exe",
    );
    assert.deepEqual(parsed.tools?.disabled, [
      "web_search",
      "web_fetch",
      "explain_image",
      "python_exec",
    ]);
    assert.deepEqual(parsed.skills?.disabled, ["diagram", "imagegen"]);
    assert.deepEqual(parsed.skills?.agentBrowser?.enabled, ["core", "dogfood"]);
    assert.deepEqual(parsed.tools?.bash?.autoPromotion, {
      enabled: false,
      afterMs: 240_000,
    });
    assert.equal(
      updateSettingsRequestSchema.safeParse({
        tools: { disabled: ["python"] },
      }).success,
      false,
    );
    assert.deepEqual(parsed.tools?.jira, {
      enabled: true,
      profileId: "work",
    });
    assert.deepEqual(parsed.tools?.confluence, {
      enabled: true,
      profileId: "work",
    });
    assert.deepEqual(parsed.tools?.web, { tavilyProfileId: "search" });
    assert.equal(parsed.providers?.atlassianProfiles?.[0]?.name, "Work");
    assert.equal(parsed.providers?.tavilyProfiles?.[0]?.name, "Search");
    assert.deepEqual(parsed.tools?.imageExplanation, {
      model: { provider: "google", modelId: "gemini-2.5-flash" },
      thinkingLevel: "high",
    });
    assert.deepEqual(parsed.tools?.imageGeneration, {
      provider: "openai-codex",
      model: "gpt-image-2.5-sunburst",
      options: {
        quality: "max",
        size: "2048x2048",
        background: "transparent",
      },
    });
    const validImageGeneration = {
      provider: "openai-codex",
      model: "gpt-image-2.5-flare",
      options: { quality: "auto", size: "auto", background: "auto" },
    } as const;
    for (const imageGeneration of [
      { ...validImageGeneration, provider: "google" },
      { ...validImageGeneration, model: "gpt-image-latest" },
      { ...validImageGeneration, model: "gpt-image-2" },
      {
        ...validImageGeneration,
        options: { ...validImageGeneration.options, quality: "ultra" },
      },
      {
        ...validImageGeneration,
        options: { ...validImageGeneration.options, size: "1000x1000" },
      },
      {
        ...validImageGeneration,
        options: { ...validImageGeneration.options, background: "green" },
      },
    ]) {
      assert.equal(
        updateSettingsRequestSchema.safeParse({
          tools: { imageGeneration },
        }).success,
        false,
      );
    }
    const cleared = updateSettingsRequestSchema.parse({
      runtime: { pythonExecutablePath: null, shellPath: null },
      tools: {
        jira: { profileId: null },
        confluence: { profileId: null },
        web: { tavilyProfileId: null },
      },
    });
    assert.equal(cleared.runtime?.pythonExecutablePath, null);
    assert.equal(cleared.runtime?.shellPath, null);
    assert.equal(cleared.tools?.jira?.profileId, null);
    assert.equal(cleared.tools?.confluence?.profileId, null);
    assert.equal(cleared.tools?.web?.tavilyProfileId, null);

    assert.throws(() =>
      updateSettingsRequestSchema.parse({
        tools: { bash: { autoPromotion: { afterMs: 0 } } },
      }),
    );
    assert.throws(() =>
      updateSettingsRequestSchema.parse({
        tools: { bash: { autoPromotion: { afterMs: 86_400_001 } } },
      }),
    );
  });
});
