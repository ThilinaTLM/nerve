import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultSettings,
  settingsSchema,
  updateApplicationConfigurationRequestSchema,
  updateSettingsRequestSchema,
} from "../../src/domains/settings/index.js";

describe("settings schema", () => {
  it("round-trips canonical defaults", () => {
    assert.deepEqual(settingsSchema.parse(defaultSettings), defaultSettings);
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
        defaultPermissionLevel: "autonomous",
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
        theme: "ocean",
        colorMode: "dark",
      },
      desktop: { headerType: "macos" },
      skills: {
        disabled: ["diagram", "imagegen"],
        agentBrowser: { enabled: ["core", "dogfood"] },
      },
      tools: {
        disabled: [
          "explore",
          "web_search",
          "web_fetch",
          "explain_image",
          "python_exec",
        ],
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
      "explore",
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
