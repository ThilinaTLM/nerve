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
    assert.equal(settings.defaultModel, undefined);
    assert.equal(settings.rememberLastAgentSelection, false);
    assert.deepEqual(settings.lastAgentSelection, {
      mode: "coding",
      permissionLevel: "autonomous",
      thinkingLevel: "off",
    });
    assert.deepEqual(settings.runtime, {});
    assert.deepEqual(settings.tools.disabled, []);
    assert.equal(settings.compaction.auto, true);
  });

  it("backfills new defaults for older config files", () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      defaultThinkingLevel: undefined,
      rememberLastAgentSelection: undefined,
      lastAgentSelection: undefined,
      tools: undefined,
    });

    assert.equal(settings.defaultThinkingLevel, "off");
    assert.equal(settings.rememberLastAgentSelection, false);
    assert.equal(settings.lastAgentSelection.mode, "coding");
    assert.equal(settings.lastAgentSelection.permissionLevel, "autonomous");
    assert.equal(settings.lastAgentSelection.thinkingLevel, "off");
    assert.deepEqual(settings.runtime, {});
    assert.deepEqual(settings.tools.disabled, []);
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

  it("accepts runtime and tool update settings", () => {
    const parsed = updateSettingsRequestSchema.parse({
      runtime: {
        pythonExecutablePath: "/usr/bin/python3",
        shellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      },
      tools: { disabled: ["web_search", "web_fetch", "python"] },
    });
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
    const cleared = updateSettingsRequestSchema.parse({
      runtime: { pythonExecutablePath: null, shellPath: null },
    });
    assert.equal(cleared.runtime?.pythonExecutablePath, null);
    assert.equal(cleared.runtime?.shellPath, null);
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
