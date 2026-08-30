import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  assertApplicationConfigurationEditable,
  resolveApplicationConfiguration,
} from "../../../src/infrastructure/configuration/index.js";

function resolve(env: NodeJS.ProcessEnv = {}, argv: string[] = []) {
  return resolveApplicationConfiguration({
    settings: structuredClone(defaultSettings),
    env,
    argv,
    dataDir: "/data/nerve",
    platform: "linux",
  });
}

describe("application configuration resolution", () => {
  it("uses environment and command-line precedence with source metadata", () => {
    const result = resolve({ NERVE_PORT: "4000", NERVE_ALLOW_REMOTE: "0" }, [
      "--port",
      "5000",
    ]);
    assert.equal(result.values.port, 5000);
    assert.deepEqual(result.snapshot.application.network.port.source, {
      kind: "command_line",
      name: "--port",
    });
    assert.equal(result.values.allowRemote, false);
    assert.equal(
      result.snapshot.application.network.allowRemote.source.name,
      "NERVE_ALLOW_REMOTE",
    );
    assert.equal(
      result.snapshot.application.network.allowRemote.editable,
      false,
    );
  });

  it("normalizes legacy and environment heap limits without changing precedence metadata", () => {
    const settings = structuredClone(defaultSettings);
    settings.application.daemon.maxOldSpaceMb = 128;
    const saved = resolveApplicationConfiguration({
      settings,
      env: {},
      argv: [],
      dataDir: "/data/nerve",
    });
    assert.equal(saved.values.maxOldSpaceMb, 512);
    assert.equal(
      saved.snapshot.application.daemon.maxOldSpaceMb.savedValue,
      128,
    );
    assert.equal(
      saved.snapshot.application.daemon.maxOldSpaceMb.activeValue,
      512,
    );
    assert.equal(
      saved.snapshot.application.daemon.maxOldSpaceMb.source.kind,
      "settings",
    );

    const environment = resolve({ NERVE_DAEMON_MAX_OLD_SPACE_MB: "256" });
    assert.equal(environment.values.maxOldSpaceMb, 512);
    assert.deepEqual(
      environment.snapshot.application.daemon.maxOldSpaceMb.source,
      {
        kind: "environment",
        name: "NERVE_DAEMON_MAX_OLD_SPACE_MB",
      },
    );
    assert.equal(
      environment.snapshot.application.daemon.maxOldSpaceMb.savedValue,
      4096,
    );
  });

  it("makes a remote opt-in bind to the LAN when no host is supplied", () => {
    const result = resolve({ NERVE_ALLOW_REMOTE: "1" });
    assert.equal(result.values.allowRemote, true);
    assert.equal(result.values.host, "0.0.0.0");
  });

  it("rejects invalid explicit values", () => {
    assert.throws(
      () => resolve({ NERVE_LOGGING_ENABLED: "sometimes" }),
      /NERVE_LOGGING_ENABLED/,
    );
    assert.throws(() => resolve({ NERVE_PORT: "70000" }), /NERVE_PORT/);
  });

  it("does not report the unsaved development performance fallback as pending", () => {
    const settings = structuredClone(defaultSettings);
    settings.application.diagnostics.performanceEnabled = undefined;
    const result = resolveApplicationConfiguration({
      settings,
      env: {},
      argv: [],
      dataDir: "/data/nerve",
      development: true,
    });
    assert.equal(
      result.snapshot.application.diagnostics.performanceEnabled.activeValue,
      true,
    );
    assert.equal(
      result.snapshot.application.diagnostics.performanceEnabled.savedValue,
      true,
    );
    assert.equal(
      result.snapshot.application.diagnostics.performanceEnabled.pendingRestart,
      false,
    );
    assert.equal(
      result.snapshot.application.diagnostics.performanceEnabled.source.kind,
      "development_default",
    );
  });

  it("tracks saved startup changes without changing the active value", () => {
    const initial = resolve();
    const settings = structuredClone(defaultSettings);
    settings.application.network.port = 5000;
    const refreshed = resolveApplicationConfiguration({
      settings,
      env: {},
      argv: [],
      dataDir: "/data/nerve",
      activeSnapshot: initial.snapshot,
    });
    assert.equal(refreshed.snapshot.application.network.port.activeValue, 3747);
    assert.equal(refreshed.snapshot.application.network.port.savedValue, 5000);
    assert.equal(
      refreshed.snapshot.application.network.port.pendingRestart,
      true,
    );
  });

  it("rejects writes to externally controlled settings", () => {
    const result = resolve({ NERVE_PORT: "4000" });
    assert.throws(
      () =>
        assertApplicationConfigurationEditable(result.snapshot, {
          application: { network: { port: 5000 } },
        }),
      /NERVE_PORT/,
    );
  });
});
