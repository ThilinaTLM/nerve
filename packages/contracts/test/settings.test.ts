import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultSettings,
  settingsSchema,
  updateSettingsRequestSchema,
} from "../src/index.js";

describe("settings schema", () => {
  it("backfills new defaults for older config files", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      defaultThinkingLevel: undefined,
      rememberLastAgentSelection: undefined,
      lastAgentSelection: undefined,
      notifications: undefined,
      transcription: undefined,
      ui: {
        theme: undefined,
        colorMode: undefined,
        zoomLevel: undefined,
        onboardingVersion: 4,
      },
      desktop: { closeToTray: true, headerType: undefined },
      tools: undefined,
      permissions: undefined,
      skills: undefined,
    });

    assert.equal(settings.defaultThinkingLevel, "off");
    assert.equal(settings.rememberLastAgentSelection, false);
    assert.equal(settings.lastAgentSelection.mode, "coding");
    assert.equal(settings.lastAgentSelection.permissionLevel, "autonomous");
    assert.equal(settings.lastAgentSelection.thinkingLevel, "off");
    assert.deepEqual(settings.runtime, {});
    assert.deepEqual(settings.permissions, { exceptions: [] });
    assert.deepEqual(settings.ui, {
      theme: "nerve",
      colorMode: "system",
      zoomLevel: 0,
    });
    assert.deepEqual(settings.desktop, {
      closeToTray: true,
      headerType: "auto",
    });
    assert.deepEqual(settings.application, defaultSettings.application);
    assert.deepEqual(settings.notifications, {
      systemEnabled: true,
      soundsEnabled: true,
      events: {
        question: "bell",
        planReview: "chime",
        approval: "bell",
        completed: "success",
        failed: "alert",
      },
    });
    assert.deepEqual(settings.transcription, {
      model: "gpt-4o-transcribe",
      languages: [],
      vocabulary: [],
    });
    assert.deepEqual(settings.tools.disabled, ["explain_image"]);
    assert.deepEqual(settings.skills.disabled, []);
    assert.deepEqual(settings.skills.agentBrowser.enabled, []);
    assert.deepEqual(settings.tools.bash.autoPromotion, {
      enabled: true,
      afterMs: 120_000,
    });
    assert.equal(settings.tools.jira.enabled, false);
    assert.equal(settings.tools.confluence.enabled, false);
    assert.deepEqual(settings.tools.web, {});
    assert.deepEqual(settings.providers, {
      atlassianProfiles: [],
      tavilyProfiles: [],
    });
    assert.deepEqual(settings.tools.imageExplanation, {
      thinkingLevel: "off",
    });
  });

  it("validates bounded permission exceptions", () => {
    const patch = updateSettingsRequestSchema.parse({
      permissions: {
        exceptions: [
          {
            id: "exception_datadog",
            effect: "allow",
            selector: {
              kind: "command_prefix",
              tokens: ["datadog", "logs", "read"],
            },
            risk: "command",
          },
          {
            id: "exception_secrets",
            effect: "deny",
            selector: {
              kind: "path_glob",
              access: "read_write",
              pattern: "secrets/**",
            },
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
              effect: "allow",
              selector: { kind: "tool", toolName: "python_exec" },
              risk: "command",
            },
          ],
        },
      }),
    );
  });

  it("backfills event tones for the previous notification settings shape", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      notifications: { systemEnabled: false, soundsEnabled: true },
    });

    assert.deepEqual(settings.notifications.events, {
      question: "bell",
      planReview: "chime",
      approval: "bell",
      completed: "success",
      failed: "alert",
    });
  });

  it("strips legacy compaction token fields while backfilling defaults", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      compaction: {
        reserveTokens: 32_000,
        keepRecentTokens: 64_000,
      },
    });

    assert.deepEqual(settings.compaction, {
      auto: true,
      profile: "balanced",
      customTriggerPercent: 80,
      customKeepRecentPercent: 15,
    });
  });

  it("backfills partial Bash auto-promotion settings", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      tools: {
        ...defaultSettings.tools,
        bash: { autoPromotion: { enabled: false } },
      },
    });

    assert.deepEqual(settings.tools.bash.autoPromotion, {
      enabled: false,
      afterMs: 120_000,
    });
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
        theme: "ocean",
        colorMode: "dark",
      },
      desktop: { headerType: "macos" },
      skills: {
        disabled: ["diagram", "imagegen"],
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
      theme: "ocean",
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
