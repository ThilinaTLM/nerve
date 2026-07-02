import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultSettings,
  settingsSchema,
  statusResponseSchema,
  updateSettingsRequestSchema,
} from "../src/index.js";

describe("settings schema", () => {
  it("fills new-agent model and last-selection defaults", () => {
    const settings = settingsSchema.parse(defaultSettings);

    assert.equal(settings.defaultThinkingLevel, "off");
    assert.deepEqual(settings.defaultApprovalPolicy, {
      autoApproveReadOnly: true,
    });
    assert.equal(settings.defaultModel, undefined);
    assert.equal(settings.rememberLastAgentSelection, false);
    assert.deepEqual(settings.lastAgentSelection, {
      mode: "coding",
      permissionLevel: "autonomous",
      approvalPolicy: { autoApproveReadOnly: true },
      thinkingLevel: "off",
    });
    assert.deepEqual(settings.runtime, {});
    assert.deepEqual(settings.tools.disabled, []);
    assert.equal(settings.tools.jira.enabled, false);
    assert.equal(settings.tools.confluence.enabled, false);
    assert.equal(settings.compaction.auto, true);
  });

  it("backfills new defaults for older config files", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      defaultThinkingLevel: undefined,
      defaultApprovalPolicy: undefined,
      rememberLastAgentSelection: undefined,
      lastAgentSelection: undefined,
      tools: undefined,
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
    assert.deepEqual(settings.tools.disabled, []);
    assert.equal(settings.tools.jira.enabled, false);
    assert.equal(settings.tools.confluence.enabled, false);
  });

  it("strips legacy compaction token fields while backfilling auto default", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      compaction: {
        reserveTokens: 32_000,
        keepRecentTokens: 64_000,
      },
    });

    assert.deepEqual(settings.compaction, { auto: true });
  });

  it("backfills tool provider defaults when older configs only have disabled tools", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      tools: { disabled: ["web_search"] },
    });

    assert.deepEqual(settings.tools.disabled, ["web_search"]);
    assert.deepEqual(settings.tools.jira, { enabled: false });
    assert.deepEqual(settings.tools.confluence, { enabled: false });
  });

  it("accepts runtime and tool update settings", () => {
    const parsed = updateSettingsRequestSchema.parse({
      runtime: {
        pythonExecutablePath: "/usr/bin/python3",
        shellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      },
      defaultApprovalPolicy: { autoApproveReadOnly: false },
      lastAgentSelection: {
        approvalPolicy: { autoApproveReadOnly: false },
      },
      tools: {
        disabled: ["web_search", "web_fetch", "python"],
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
      },
    });
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
      "python",
    ]);
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
  });

  it("accepts python runtime status", () => {
    const parsed = statusResponseSchema.parse({
      daemonId: "daemon_01HN0000000000000000000000",
      version: "0.0.0",
      startedAt: "2026-01-01T00:00:00.000Z",
      dataDir: "/tmp/nerve",
      storage: {
        home: "/tmp/nerve",
        sqlitePath: "/tmp/nerve/index.sqlite",
        indexHealthy: true,
      },
      runtime: {
        python: {
          available: true,
          source: "path",
          executable: "/usr/bin/python3",
          version: "3.12.0",
        },
        editors: {
          vscode: {
            available: true,
            source: "path",
            executable: "/usr/bin/code",
          },
          zed: {
            available: false,
            error: "zed executable not found",
          },
        },
      },
    });

    assert.equal(parsed.runtime.python.available, true);
    assert.equal(parsed.runtime.editors.vscode.available, true);
    assert.equal(parsed.runtime.editors.zed.available, false);
  });
});
