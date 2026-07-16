import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ManagedSandboxRecord,
  SandboxStatusGetResult,
} from "@nervekit/contracts";
import {
  computeSandboxBootProgress,
  groupBootPhases,
  type BootPhase,
} from "./sandbox-boot-progress";
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
    lifecycleState:
      observedState === "running"
        ? "container_started"
        : observedState === "failed"
          ? "failed"
          : observedState === "exited"
            ? "stopped"
            : "container_starting",
    lifecycleUpdatedAt: ts,
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

  it("shows only the connection step active before the agent connects", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({ status: "booting", connected: false });

    const progress = computeSandboxBootProgress(record("running"), detail);
    assert.deepEqual(
      progress.phases
        .filter((phase) => phase.status === "active")
        .map((phase) => phase.id),
      ["daemon"],
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

  it("orders skills before boot and keeps ready pending while boot is active", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({
      status: "booting",
      setup: {
        git: { configured: true, status: "completed", completedAt: ts },
        github: { configured: true, status: "completed", completedAt: ts },
        skills: { configured: true, status: "completed", completedAt: ts },
        boot: { configured: true, status: "started", startedAt: ts },
      },
    });

    const progress = computeSandboxBootProgress(record("running"), detail);
    assert.deepEqual(
      progress.phases.map((phase) => phase.id),
      [
        "container",
        "config",
        "state",
        "daemon",
        "preflight",
        "models",
        "secrets",
        "git",
        "github",
        "context",
        "skills",
        "boot",
        "runtime",
        "ready",
      ],
    );
    assert.equal(
      progress.phases.find((phase) => phase.id === "boot")?.status,
      "active",
    );
    assert.equal(
      progress.phases.find((phase) => phase.id === "ready")?.status,
      "pending",
    );
  });

  it("marks ready active only after all prior phases are terminal", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({
      status: "booting",
      setup: {
        git: { configured: true, status: "completed", completedAt: ts },
        github: { configured: true, status: "completed", completedAt: ts },
        skills: { configured: true, status: "completed", completedAt: ts },
        boot: { configured: true, status: "completed", completedAt: ts },
      },
    });

    const progress = computeSandboxBootProgress(record("running"), detail);
    assert.equal(
      progress.phases.find((phase) => phase.id === "ready")?.status,
      "active",
    );
  });

  it("uses status setup timeline details before the controller connects", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({
      status: "booting",
      setup: {
        git: { configured: true, status: "completed", completedAt: ts },
        github: { configured: true, status: "completed", completedAt: ts },
        skills: { configured: true, status: "completed", completedAt: ts },
      },
      setupTimeline: [
        {
          key: "boot:0",
          phase: "boot",
          name: "install",
          index: 0,
          status: "started",
          ts,
          startedAt: ts,
          runAs: "sandbox",
          network: "inherit",
          timeoutMs: 60_000,
        },
      ],
    });

    const progress = computeSandboxBootProgress(record("running"), detail);
    const boot = progress.phases.find((phase) => phase.id === "boot");
    assert.equal(boot?.status, "active");
    assert.equal(boot?.ts, ts);
    assert.equal(
      progress.phases.find((phase) => phase.id === "ready")?.status,
      "pending",
    );
  });

  it("counts degraded setup as terminal progress", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({
      status: "booting",
      setup: {
        git: { configured: true, status: "completed", completedAt: ts },
        github: { configured: true, status: "degraded", completedAt: ts },
        skills: { configured: true, status: "completed", completedAt: ts },
        boot: { configured: true, status: "completed", completedAt: ts },
      },
    });

    const progress = computeSandboxBootProgress(record("running"), detail);
    assert.equal(progress.completed, 13);
    assert.equal(
      progress.phases.find((phase) => phase.id === "github")?.status,
      "degraded",
    );
    assert.equal(
      progress.phases.find((phase) => phase.id === "ready")?.status,
      "active",
    );
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

  it("keeps reconnecting distinct from initial boot", () => {
    const detail = createSandboxDetailState("sbx_1");
    detail.status = status({
      status: "reconnecting",
      connected: false,
      connectivity: {
        state: "reconnecting",
        reconnectAttempts: 3,
        disconnectedAt: ts,
      },
    });

    const progress = computeSandboxBootProgress(
      { ...record("running"), lifecycleState: "reconnecting" },
      detail,
    );
    assert.equal(progress.state, "reconnecting");
    assert.equal(progress.headline, "Reconnecting…");
    assert.equal(progress.showPhaseStepper, true);
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

  it("exposes launch groups alongside the fine-grained phases", () => {
    const detail = createSandboxDetailState("sbx_1");
    const progress = computeSandboxBootProgress(record("running"), detail);
    assert.deepEqual(
      progress.groups.map((group) => group.id),
      ["provision", "connect", "prepare", "boot", "start"],
    );
    assert.equal(
      progress.groups.reduce((sum, group) => sum + group.phases.length, 0),
      progress.phases.length,
    );
  });
});

function phase(
  id: BootPhase["id"],
  phaseStatus: BootPhase["status"],
  extra: Partial<BootPhase> = {},
): BootPhase {
  return { id, label: id, description: id, status: phaseStatus, ...extra };
}

describe("groupBootPhases", () => {
  it("keeps groups pending before any phase starts", () => {
    const groups = groupBootPhases([
      phase("container", "pending"),
      phase("config", "pending"),
      phase("state", "pending"),
      phase("daemon", "pending"),
    ]);
    assert.ok(
      groups.every(
        (group) => group.phases.length === 0 || group.status === "pending",
      ),
    );
  });

  it("marks a group active while a phase runs and reports the active phase", () => {
    const groups = groupBootPhases([
      phase("preflight", "done"),
      phase("models", "active", { ts: "2026-07-07T17:06:12.000Z" }),
      phase("secrets", "pending"),
      phase("git", "pending"),
      phase("github", "pending"),
      phase("context", "pending"),
      phase("skills", "pending"),
    ]);
    const prepare = groups.find((group) => group.id === "prepare");
    assert.equal(prepare?.status, "active");
    assert.equal(prepare?.activePhase?.id, "models");
  });

  it("treats a partially completed group without a live phase as active", () => {
    const groups = groupBootPhases([
      phase("config", "done"),
      phase("state", "done"),
      phase("daemon", "pending"),
    ]);
    assert.equal(
      groups.find((group) => group.id === "connect")?.status,
      "active",
    );
  });

  it("rolls up failure with the failing phase error", () => {
    const groups = groupBootPhases([
      phase("preflight", "done"),
      phase("models", "failed", { error: "MODEL_RESOLVE: no provider" }),
      phase("secrets", "pending"),
    ]);
    const prepare = groups.find((group) => group.id === "prepare");
    assert.equal(prepare?.status, "failed");
    assert.equal(prepare?.error, "MODEL_RESOLVE: no provider");
  });

  it("rolls up degraded when everything finished but a phase degraded", () => {
    const groups = groupBootPhases([
      phase("preflight", "done"),
      phase("models", "degraded", { error: "fallback model in use" }),
      phase("secrets", "skipped"),
      phase("git", "done"),
      phase("github", "skipped"),
      phase("context", "done"),
      phase("skills", "done"),
    ]);
    const prepare = groups.find((group) => group.id === "prepare");
    assert.equal(prepare?.status, "degraded");
    assert.equal(prepare?.error, "fallback model in use");
  });

  it("reports done with the latest phase timestamp", () => {
    const groups = groupBootPhases([
      phase("config", "done", { ts: "2026-07-07T17:06:11.000Z" }),
      phase("state", "done", { ts: "2026-07-07T17:06:13.000Z" }),
      phase("daemon", "done", { ts: "2026-07-07T17:06:12.000Z" }),
    ]);
    const connect = groups.find((group) => group.id === "connect");
    assert.equal(connect?.status, "done");
    assert.equal(connect?.ts, "2026-07-07T17:06:13.000Z");
  });

  it("reports skipped when every phase was skipped", () => {
    const groups = groupBootPhases([phase("boot", "skipped")]);
    assert.equal(
      groups.find((group) => group.id === "boot")?.status,
      "skipped",
    );
  });
});
