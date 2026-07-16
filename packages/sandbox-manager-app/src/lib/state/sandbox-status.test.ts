import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ManagedSandboxLifecycleState,
  ManagedSandboxRecord,
} from "@nervekit/contracts";
import { canRestart } from "./sandbox-status";

function record(
  lifecycleState: ManagedSandboxLifecycleState,
): ManagedSandboxRecord {
  return {
    sandboxId: "sbx_1",
    instanceId: "inst_1",
    backend: "docker",
    image: { reference: "img", sandboxSpec: "v1" },
    desiredState: lifecycleState === "removed" ? "removed" : "running",
    observedState: "running",
    lifecycleState,
    workspaceRef: { kind: "bind", source: "/tmp/w", target: "/workspace" },
    stateRef: { kind: "bind", source: "/tmp/s", target: "/state" },
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
  };
}

describe("canRestart", () => {
  it("allows restart from stable, failed, and reconnecting states", () => {
    for (const state of [
      "ready",
      "degraded",
      "failed",
      "stopped",
      "reconnecting",
      "booting",
      "daemon_connected",
      "container_started",
    ] as const)
      assert.equal(canRestart(record(state)), true, state);
  });

  it("disables restart during create/start/stop and after removal", () => {
    for (const state of [
      "container_creating",
      "container_starting",
      "stopping",
      "removed",
    ] as const)
      assert.equal(canRestart(record(state)), false, state);
  });
});
