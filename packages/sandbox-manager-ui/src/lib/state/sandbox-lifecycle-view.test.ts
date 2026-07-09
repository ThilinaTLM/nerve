import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ManagedSandboxRecord,
  SandboxStatusGetResult,
} from "@nervekit/shared";
import { sandboxLifecycleView } from "./sandbox-lifecycle-view";
import { createSandboxDetailState } from "./sandbox-ui-types";

const ts = "2026-07-10T12:00:00.000Z";

function record(
  lifecycleState: ManagedSandboxRecord["lifecycleState"],
): ManagedSandboxRecord {
  return {
    sandboxId: "sbx_1",
    instanceId: "inst_1",
    backend: "docker",
    image: { reference: "image", sandboxSpec: "v1" },
    desiredState:
      lifecycleState === "stopped"
        ? "stopped"
        : lifecycleState === "removed"
          ? "removed"
          : "running",
    observedState:
      lifecycleState === "failed"
        ? "failed"
        : lifecycleState === "stopped"
          ? "exited"
          : lifecycleState === "removed"
            ? "removed"
            : "running",
    lifecycleState,
    lifecycleUpdatedAt: ts,
    workspaceRef: { kind: "bind", source: "/tmp/w", target: "/workspace" },
    stateRef: { kind: "bind", source: "/tmp/s", target: "/state" },
    createdAt: ts,
    updatedAt: ts,
  };
}

function status(
  value: Partial<SandboxStatusGetResult>,
): SandboxStatusGetResult {
  return {
    instanceId: "inst_1",
    status: "booting",
    connected: false,
    updatedAt: ts,
    ...value,
  };
}

describe("sandboxLifecycleView", () => {
  it("derives clear terminal and ready states", () => {
    for (const [input, expected] of [
      ["ready", "ready"],
      ["degraded", "degraded"],
      ["stopping", "stopping"],
      ["stopped", "stopped"],
      ["failed", "failed"],
      ["removed", "removed"],
    ] as const) {
      const detail = createSandboxDetailState("sbx_1");
      detail.status = status({
        status:
          expected === "ready" || expected === "degraded"
            ? expected
            : expected === "stopped" || expected === "removed"
              ? "offline"
              : expected,
        connected: expected === "ready" || expected === "degraded",
      });
      assert.equal(sandboxLifecycleView(record(input), detail).state, expected);
    }
  });

  it("treats connection loss after readiness as reconnecting, not starting", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({
      status: "reconnecting",
      connectivity: { state: "reconnecting", reconnectAttempts: 4 },
      lastSession: {
        sessionId: "sess_1",
        connectedAt: ts,
        readyAt: ts,
        agentStatus: "ready",
      },
    });
    const view = sandboxLifecycleView(record("reconnecting"), detail);
    assert.equal(view.state, "reconnecting");
    assert.equal(view.reconnectAttempts, 4);
    assert.match(view.description, /Retry 4/);
    assert.equal(view.defaultDetailsOpen, true);
  });

  it("surfaces the exact failed startup stage", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({
      status: "failed",
      setupTimeline: [
        {
          key: "preflight",
          phase: "preflight",
          status: "failed",
          ts,
          error: "MOUNT_INVALID: workspace is not writable",
        },
      ],
    });
    const view = sandboxLifecycleView(record("failed"), detail);
    assert.equal(view.issue?.stage, "preflight");
    assert.equal(view.issue?.code, "MOUNT_INVALID");
    assert.match(view.headline, /environment failed/i);
    assert.equal(view.primaryAction, "open_logs");
  });

  it("treats a created but not started sandbox as stopped and actionable", () => {
    const created = {
      ...record("record_created"),
      desiredState: "created" as const,
      observedState: "unknown" as const,
    };
    const view = sandboxLifecycleView(created, undefined);
    assert.equal(view.state, "stopped");
    assert.equal(view.primaryAction, "start");
    assert.equal(view.defaultDetailsOpen, false);
  });

  it("does not call a running container ready before readiness is announced", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({ status: "booting", connected: true });
    const view = sandboxLifecycleView(record("booting"), detail);
    assert.equal(view.state, "starting");
    assert.equal(view.primaryAction, "none");
  });
});
