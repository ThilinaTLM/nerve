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
      defaultApprovalPolicy: undefined,
      rememberLastAgentSelection: undefined,
      lastAgentSelection: undefined,
      notifications: undefined,
      ui: {
        theme: undefined,
        colorMode: undefined,
        zoomLevel: undefined,
        onboardingVersion: 4,
      },
      desktop: { closeToTray: true, headerType: undefined },
      tools: undefined,
      skills: undefined,
    });

    assert.equal(settings.defaultThinkingLevel, "off");
    assert.deepEqual(settings.defaultApprovalPolicy, {
      autoApproveReadOnly: true,
    });
    assert.equal(settings.rememberLastAgentSelection, false);
    assert.equal(settings.lastAgentSelection.mode, "coding");
    assert.equal(settings.lastAgentSelection.permissionLevel, "autonomous");
    assert.equal(
      settings.lastAgentSelection.approvalPolicy.autoApproveReadOnly,
      true,
    );
    assert.equal(settings.lastAgentSelection.thinkingLevel, "off");
    assert.deepEqual(settings.runtime, {});
    assert.deepEqual(settings.ui, {
      theme: "nerve",
      colorMode: "system",
      zoomLevel: 0,
    });
    assert.deepEqual(settings.desktop, {
      closeToTray: true,
      headerType: "auto",
    });
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
    assert.deepEqual(settings.tools.disabled, ["explain_image"]);
    assert.deepEqual(settings.skills.disabled, []);
    assert.deepEqual(settings.skills.agentBrowser.enabled, []);
    assert.deepEqual(settings.tools.bash.autoPromotion, {
      enabled: true,
      afterMs: 120_000,
    });
    assert.equal(settings.tools.jira.enabled, false);
    assert.equal(settings.tools.confluence.enabled, false);
    assert.deepEqual(settings.tools.imageExplanation, {
      thinkingLevel: "off",
    });
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
      runtime: {
        pythonExecutablePath: "/usr/bin/python3",
        shellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      },
      ui: {
        theme: "ocean",
        colorMode: "dark",
      },
      desktop: { headerType: "macos" },
      defaultApprovalPolicy: { autoApproveReadOnly: false },
      lastAgentSelection: {
        approvalPolicy: { autoApproveReadOnly: false },
      },
      skills: {
        disabled: ["diagram", "imagegen"],
        agentBrowser: { enabled: ["core", "dogfood"] },
      },
      tools: {
        disabled: ["web_search", "web_fetch", "explain_image", "python_exec"],
        bash: {
          autoPromotion: { enabled: false, afterMs: 240_000 },
        },
        jira: {
          enabled: true,
          siteUrl: "https://example.atlassian.net",
          email: "user@example.com",
          defaultProjectKey: "PROJ",
        },
        confluence: {
          enabled: true,
          siteUrl: "https://example.atlassian.net",
          email: "user@example.com",
          defaultSpaceKey: "DEV",
        },
        imageExplanation: {
          model: { provider: "google", modelId: "gemini-2.5-flash" },
          thinkingLevel: "high",
        },
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
    assert.equal(parsed.defaultApprovalPolicy?.autoApproveReadOnly, false);
    assert.equal(
      parsed.lastAgentSelection?.approvalPolicy?.autoApproveReadOnly,
      false,
    );
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
    assert.equal(parsed.tools?.jira?.enabled, true);
    assert.equal(parsed.tools?.jira?.siteUrl, "https://example.atlassian.net");
    assert.equal(parsed.tools?.jira?.email, "user@example.com");
    assert.equal(parsed.tools?.jira?.defaultProjectKey, "PROJ");
    assert.equal(parsed.tools?.confluence?.enabled, true);
    assert.equal(
      parsed.tools?.confluence?.siteUrl,
      "https://example.atlassian.net",
    );
    assert.equal(parsed.tools?.confluence?.email, "user@example.com");
    assert.equal(parsed.tools?.confluence?.defaultSpaceKey, "DEV");
    assert.deepEqual(parsed.tools?.imageExplanation, {
      model: { provider: "google", modelId: "gemini-2.5-flash" },
      thinkingLevel: "high",
    });
    const cleared = updateSettingsRequestSchema.parse({
      runtime: { pythonExecutablePath: null, shellPath: null },
      tools: {
        jira: { siteUrl: null, email: null, defaultProjectKey: null },
        confluence: { siteUrl: null, email: null, defaultSpaceKey: null },
      },
    });
    assert.equal(cleared.runtime?.pythonExecutablePath, null);
    assert.equal(cleared.runtime?.shellPath, null);
    assert.equal(cleared.tools?.jira?.siteUrl, null);
    assert.equal(cleared.tools?.jira?.email, null);
    assert.equal(cleared.tools?.jira?.defaultProjectKey, null);
    assert.equal(cleared.tools?.confluence?.siteUrl, null);
    assert.equal(cleared.tools?.confluence?.email, null);
    assert.equal(cleared.tools?.confluence?.defaultSpaceKey, null);

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
