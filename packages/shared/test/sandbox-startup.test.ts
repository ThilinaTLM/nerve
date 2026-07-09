import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sandboxProtocolEventSchema,
  summarizeSandboxStartupEvents,
} from "../src/index.js";

const ts = "2026-07-10T12:00:00.000Z";

function event(seq: number, type: string, data: unknown) {
  return { seq, type, ts, data };
}

describe("sandbox startup telemetry", () => {
  it("validates typed stage events and disconnects without an exit deadline", () => {
    assert.equal(
      sandboxProtocolEventSchema.safeParse({
        id: "evt_1",
        seq: 1,
        ts,
        type: "sandbox.startup.stage.completed",
        durability: "durable",
        data: {
          instanceId: "inst_1",
          stage: "preflight",
          attempt: 1,
          status: "failed",
          startedAt: ts,
          completedAt: ts,
          durationMs: 0,
          error: { code: "MOUNT_INVALID", message: "not writable" },
        },
      }).success,
      true,
    );
    assert.equal(
      sandboxProtocolEventSchema.safeParse({
        id: "evt_2",
        seq: 2,
        ts,
        type: "sandbox.controller.disconnected",
        durability: "durable",
        data: {
          instanceId: "inst_1",
          disconnectedAt: ts,
          reason: "network_error",
          retryable: true,
          reconnectAttempts: 1,
        },
      }).success,
      true,
    );
  });

  it("merges stages, preserves boot diagnostics, and selects the exact failure", () => {
    const summary = summarizeSandboxStartupEvents([
      event(1, "sandbox.startup.stage.started", {
        stage: "preflight",
        attempt: 1,
        startedAt: ts,
      }),
      event(2, "sandbox.startup.stage.completed", {
        stage: "preflight",
        attempt: 1,
        status: "completed",
        startedAt: ts,
        completedAt: ts,
        durationMs: 0,
      }),
      event(3, "sandbox.boot.started", {
        phase: "install",
        index: 0,
        startedAt: ts,
        timeoutMs: 30_000,
        runAs: "sandbox",
        network: "inherit",
      }),
      event(4, "sandbox.boot.completed", {
        phase: "install",
        index: 0,
        status: "failed",
        startedAt: ts,
        completedAt: ts,
        exitCode: 127,
        stderr: { text: "pnpm: not found", bytes: 15 },
      }),
    ]);
    assert.deepEqual(
      summary.timeline.map((item) => item.key),
      ["preflight", "boot:0"],
    );
    assert.equal(summary.timeline[0]?.status, "completed");
    assert.equal(summary.timeline[1]?.stderr?.text, "pnpm: not found");
    assert.equal(summary.failure?.stage, "boot");
    assert.equal(summary.failure?.error.code, "BOOT_PHASE_FAILED");
    assert.match(summary.failure?.error.message ?? "", /pnpm: not found/);
  });
});
