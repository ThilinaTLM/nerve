import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { readAgentStateSummary } from "../src/state/agent-state-summary.js";

const ts = "2026-07-07T17:06:10.000Z";

function record(stateDir: string): ManagedSandboxRecord {
  return {
    sandboxId: "sbx_1",
    instanceId: "inst_1",
    backend: "docker",
    image: { reference: "img", sandboxSpec: "v1" },
    desiredState: "running",
    observedState: "running",
    lifecycleState: "container_started",
    lifecycleUpdatedAt: ts,
    workspaceRef: { kind: "bind", source: "/tmp/w", target: "/workspace" },
    stateRef: { kind: "bind", source: stateDir, target: "/state" },
    createdAt: ts,
    updatedAt: ts,
  };
}

function event(seq: number, type: string, data: unknown) {
  return JSON.stringify({
    seq,
    id: `evt_${seq}`,
    ts: `2026-07-07T17:06:${String(10 + seq).padStart(2, "0")}.000Z`,
    type,
    delivery: "sequenced",
    data,
  });
}

describe("agent state summary", () => {
  it("projects ordered setup timeline entries with safe boot metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-agent-summary-"));
    try {
      const stateDir = path.join(dir, "state");
      const eventsDir = path.join(stateDir, "events");
      await mkdir(eventsDir, { recursive: true });
      await writeFile(
        path.join(eventsDir, "outbox.jsonl"),
        [
          event(1, "sandbox.config.loaded", {
            status: "loaded",
            completedAt: "2026-07-07T17:06:11.000Z",
          }),
          event(2, "sandbox.skills.started", {
            startedAt: "2026-07-07T17:06:12.000Z",
          }),
          event(3, "sandbox.skills.completed", {
            status: "completed",
            startedAt: "2026-07-07T17:06:12.000Z",
            completedAt: "2026-07-07T17:06:13.000Z",
          }),
          event(4, "sandbox.boot.started", {
            phase: "install",
            index: 0,
            startedAt: "2026-07-07T17:06:14.000Z",
            timeoutMs: 60_000,
            runAs: "sandbox",
            network: "inherit",
            script: "echo should-not-be-projected",
          }),
          event(5, "sandbox.boot.completed", {
            phase: "install",
            index: 0,
            status: "completed",
            startedAt: "2026-07-07T17:06:14.000Z",
            completedAt: "2026-07-07T17:06:15.000Z",
            exitCode: 0,
            stdout: { text: "installed\n", bytes: 10 },
          }),
          event(6, "sandbox.boot.started", {
            phase: "migrate",
            index: 1,
            startedAt: "2026-07-07T17:06:16.000Z",
            timeoutMs: 120_000,
            runAs: "root",
            network: "deny",
          }),
        ].join("\n"),
        "utf8",
      );

      const summary = await readAgentStateSummary(record(stateDir));
      assert.deepEqual(
        summary?.setupTimeline?.map((item) => item.key),
        ["config", "skills", "boot:0", "boot:1"],
      );
      const install = summary?.setupTimeline?.find(
        (item) => item.key === "boot:0",
      );
      assert.equal(install?.status, "completed");
      assert.equal(install?.name, "install");
      assert.equal(install?.durationMs, 1000);
      assert.equal(install?.stdout?.text, "installed\n");
      assert.equal(install?.runAs, "sandbox");
      assert.equal(install?.network, "inherit");
      assert.equal(install?.timeoutMs, 60_000);

      const migrate = summary?.setupTimeline?.find(
        (item) => item.key === "boot:1",
      );
      assert.equal(migrate?.status, "started");
      assert.equal(migrate?.runAs, "root");
      assert.equal(migrate?.network, "deny");
      assert.equal(
        JSON.stringify(summary?.setupTimeline).includes(
          "should-not-be-projected",
        ),
        false,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recovers failures from any typed startup stage", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-agent-failure-"));
    try {
      const stateDir = path.join(dir, "state");
      const eventsDir = path.join(stateDir, "events");
      await mkdir(eventsDir, { recursive: true });
      await writeFile(
        path.join(eventsDir, "outbox.jsonl"),
        [
          event(1, "sandbox.startup.stage.started", {
            stage: "preflight",
            attempt: 1,
            startedAt: ts,
          }),
          event(2, "sandbox.startup.stage.completed", {
            stage: "preflight",
            attempt: 1,
            status: "failed",
            startedAt: ts,
            completedAt: ts,
            durationMs: 0,
            error: {
              code: "MOUNT_INVALID",
              message: "workspace is not writable",
            },
          }),
        ].join("\n"),
        "utf8",
      );
      const summary = await readAgentStateSummary(record(stateDir));
      assert.equal(summary?.startupFailure?.stage, "preflight");
      assert.equal(summary?.startupFailure?.error.code, "MOUNT_INVALID");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
