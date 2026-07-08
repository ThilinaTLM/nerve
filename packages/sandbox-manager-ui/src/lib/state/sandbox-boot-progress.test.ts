import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ManagedSandboxRecord,
  SandboxStatusGetResult,
} from "@nervekit/shared";
import { computeSandboxBootProgress } from "./sandbox-boot-progress";
import { createSandboxDetailState } from "./sandbox-ui-types";

const ts = "2026-07-07T17:06:10.000Z";

function record(
  observedState: ManagedSandboxRecord["observedState"] = "running",
): ManagedSandboxRecord {
  return {
    sandboxId: "sbx_1",
    instanceId: "inst_1",
    backend: "docker",
    image: { reference: "img", sandboxSpec: "v1" },
    desiredState: "running",
    observedState,
    workspaceRef: {
      kind: "bind",
      source: "/tmp/workspace",
      target: "/workspace",
    },
    stateRef: { kind: "bind", source: "/tmp/state", target: "/state" },
    createdAt: ts,
    updatedAt: ts,
  };
}

function status(
  input: Partial<SandboxStatusGetResult>,
): SandboxStatusGetResult {
  return {
    instanceId: "inst_1",
    status: "reconnecting",
    connected: false,
    updatedAt: ts,
    ...input,
  };
}

describe("computeSandboxBootProgress", () => {
  it("shows a recovered boot failure instead of an indefinite ready spinner", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({
      status: "failed",
      setup: {
        git: { configured: true, status: "completed", completedAt: ts },
        github: { configured: true, status: "completed", completedAt: ts },
        skills: { configured: true, status: "completed", completedAt: ts },
        boot: {
          configured: true,
          status: "failed",
          startedAt: ts,
          completedAt: ts,
          error: {
            code: "BOOT_PHASE_FAILED",
            message: "Boot phase boot failed with exit code 127",
          },
        },
      },
    });

    const progress = computeSandboxBootProgress(record("failed"), detail);
    assert.equal(progress.state, "failed");
    assert.equal(progress.headline, "Boot failed");
    assert.equal(progress.showPhaseStepper, true);
    assert.equal(
      progress.phases.find((phase) => phase.id === "boot")?.status,
      "failed",
    );
    assert.equal(
      progress.phases.find((phase) => phase.id === "ready")?.status,
      "pending",
    );
  });

  it("shows the phase stepper while the sandbox is actively booting", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({ status: "booting" });

    const progress = computeSandboxBootProgress(record("running"), detail);
    assert.equal(progress.state, "booting");
    assert.equal(progress.showPhaseStepper, true);
  });

  it("hides the phase stepper after the sandbox is ready", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({ status: "ready", connected: true });

    const progress = computeSandboxBootProgress(record("running"), detail);
    assert.equal(progress.state, "ready");
    assert.equal(progress.showPhaseStepper, false);
  });

  it("shows a non-spinning offline state for stopped containers", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({
      status: "offline",
      staleness: { stale: true, reason: "container_stopped", asOf: ts },
      container: {
        runtime: "docker",
        state: "exited",
        exitCode: 0,
        observedAt: ts,
      },
    });

    const progress = computeSandboxBootProgress(
      { ...record("exited"), desiredState: "stopped" },
      detail,
    );
    assert.equal(progress.state, "offline");
    assert.equal(progress.headline, "Sandbox offline");
    assert.equal(progress.showPhaseStepper, false);
    assert.equal(
      progress.phases.find((phase) => phase.id === "container")?.status,
      "stopped",
    );
  });

  it("marks the container failed when the daemon failed before setup details were recovered", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({ status: "failed" });

    const progress = computeSandboxBootProgress(record("failed"), detail);
    assert.equal(progress.state, "failed");
    assert.equal(progress.showPhaseStepper, true);
    assert.equal(
      progress.phases.find((phase) => phase.id === "container")?.status,
      "failed",
    );
  });
});
