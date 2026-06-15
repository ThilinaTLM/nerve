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
    assert.deepEqual(settings.runtime, {});
  });

  it("accepts python runtime update settings", () => {
    assert.equal(
      updateSettingsRequestSchema.parse({
        runtime: { pythonExecutablePath: "/usr/bin/python3" },
      }).runtime?.pythonExecutablePath,
      "/usr/bin/python3",
    );
    assert.equal(
      updateSettingsRequestSchema.parse({
        runtime: { pythonExecutablePath: null },
      }).runtime?.pythonExecutablePath,
      null,
    );
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
      },
    });

    assert.equal(parsed.runtime.python.available, true);
  });
});
