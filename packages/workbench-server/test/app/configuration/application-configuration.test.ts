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
    hostResources: {
      logicalCpuCount: 20,
      effectiveCpuCount: 4,
      totalMemoryBytes: 38.8 * 1024 ** 3,
    },
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

  it("automatically recommends resource limits from host capacity", () => {
    const result = resolve();
    assert.deepEqual(result.values.resources, {
      maxConcurrentModelRuns: 10,
      maxParallelToolsPerRun: 3,
      maxActiveProcesses: 16,
      maxActiveExploreAgents: 5,
    });
    assert.equal(result.values.controlWorkConcurrency, 4);
    assert.equal(
      result.snapshot.application.resources.maxConcurrentModelRuns.source.kind,
      "automatic",
    );
    assert.deepEqual(
      result.snapshot.context.resources.effective,
      result.values.resources,
    );
  });

  it("uses saved manual resource limits and environment overrides", () => {
    const settings = structuredClone(defaultSettings);
    settings.application.resources = {
      mode: "manual",
      maxConcurrentModelRuns: 12,
      maxParallelToolsPerRun: 4,
      maxActiveProcesses: 24,
      maxActiveExploreAgents: 6,
    };
    const manual = resolveApplicationConfiguration({
      settings,
      env: {},
      argv: [],
      dataDir: "/data/nerve",
      hostResources: {
        logicalCpuCount: 20,
        effectiveCpuCount: 4,
        totalMemoryBytes: 38.8 * 1024 ** 3,
      },
    });
    assert.deepEqual(manual.values.resources, {
      maxConcurrentModelRuns: 12,
      maxParallelToolsPerRun: 4,
      maxActiveProcesses: 24,
      maxActiveExploreAgents: 6,
    });

    const overridden = resolve({
      NERVE_MAX_CONCURRENT_MODEL_RUNS: "14",
      NERVE_MAX_ACTIVE_PROCESSES: "32",
    });
    assert.equal(overridden.values.resources.maxConcurrentModelRuns, 14);
    assert.equal(overridden.values.resources.maxActiveProcesses, 32);
    assert.equal(
      overridden.snapshot.application.resources.maxConcurrentModelRuns.editable,
      false,
    );
    assert.throws(
      () =>
        assertApplicationConfigurationEditable(overridden.snapshot, {
          application: { resources: { maxConcurrentModelRuns: 11 } },
        }),
      /NERVE_MAX_CONCURRENT_MODEL_RUNS/,
    );
  });

  it("rejects invalid resource environment limits", () => {
    assert.throws(
      () => resolve({ NERVE_MAX_PARALLEL_TOOLS_PER_RUN: "17" }),
      /NERVE_MAX_PARALLEL_TOOLS_PER_RUN/,
    );
    assert.throws(
      () => resolve({ NERVE_MAX_ACTIVE_EXPLORE_AGENTS: "0" }),
      /NERVE_MAX_ACTIVE_EXPLORE_AGENTS/,
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
