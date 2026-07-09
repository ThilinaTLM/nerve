import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type {
  ContainerRuntimeDriver,
  LogChunk,
} from "../src/drivers/container-runtime-driver.js";
import { SandboxGarbageCollector } from "../src/lifecycle/garbage-collector.js";
import {
  decideOrphan,
  OrphanReconciler,
} from "../src/lifecycle/orphan-reconciler.js";
import { SandboxReconciler } from "../src/lifecycle/reconciler.js";
import { readAgentStateSummary } from "../src/state/agent-state-summary.js";
import { FileManagerStore } from "../src/state/manager-store.js";

function record(sandboxId = "sbx_1") {
  return {
    sandboxId,
    instanceId: "inst_1",
    backend: "docker",
    image: { reference: "img", sandboxSpec: "v1" as const },
    desiredState: "running" as const,
    observedState: "running" as const,
    workspaceRef: { kind: "bind", source: "/tmp/w", target: "/workspace" },
    stateRef: { kind: "bind", source: "/tmp/s", target: "/state" },
    containerRef: { kind: "docker", id: "c1", name: `nerve-${sandboxId}` },
    createdAt: "2026-06-26T12:00:00.000Z",
    updatedAt: "2026-06-26T12:00:00.000Z",
  };
}

describe("sandbox manager reconciliation gc and orphan handling", () => {
  it("updates observed state from driver inspections and self-exit 22", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-reconcile-"));
    try {
      const store = new FileManagerStore(dir);
      await store.put(record());
      const driver = fakeDriver({ state: "exited", exitCode: 22 });
      await new SandboxReconciler(store, driver).reconcile();
      assert.equal((await store.get("sbx_1"))?.observedState, "reconnecting");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("marks nonzero container exits as failed during reconciliation", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-reconcile-fail-"));
    try {
      const store = new FileManagerStore(dir);
      await store.put(record());
      const driver = fakeDriver({ state: "exited", exitCode: 13 });
      await new SandboxReconciler(store, driver).reconcile();
      const updated = await store.get("sbx_1");
      assert.equal(updated?.observedState, "failed");
      assert.equal(updated?.lastError?.code, "CONTAINER_FAILED");
      assert.match(updated?.lastError?.message ?? "", /13/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recovers boot setup failure from the sandbox agent outbox", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-agent-state-"));
    try {
      const stateDir = path.join(dir, "state");
      const eventsDir = path.join(stateDir, "events");
      await mkdir(eventsDir, { recursive: true });
      await writeFile(
        path.join(eventsDir, "outbox.jsonl"),
        [
          JSON.stringify({
            seq: 1,
            id: "evt_1",
            ts: "2026-07-07T17:06:08.000Z",
            type: "sandbox.boot.started",
            durability: "durable",
            data: { phase: "boot", startedAt: "2026-07-07T17:06:08.000Z" },
          }),
          JSON.stringify({
            seq: 2,
            id: "evt_2",
            ts: "2026-07-07T17:06:10.000Z",
            type: "sandbox.boot.completed",
            durability: "durable",
            data: {
              phase: "boot",
              status: "failed",
              exitCode: 127,
              startedAt: "2026-07-07T17:06:08.000Z",
              completedAt: "2026-07-07T17:06:10.000Z",
              stderr: { text: "/bin/sh: 2: pnpm: not found\n", bytes: 31 },
            },
          }),
        ].join("\n"),
        "utf8",
      );

      const summary = await readAgentStateSummary({
        ...record(),
        stateRef: { kind: "bind", source: stateDir, target: "/state" },
      });
      assert.equal(summary?.lastEventSeq, 2);
      assert.equal(summary?.setup?.boot?.status, "failed");
      assert.match(summary?.setup?.boot?.error?.message ?? "", /pnpm/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves failed records and removes elapsed gc records", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-gc-"));
    try {
      const store = new FileManagerStore(dir);
      await store.put({
        ...record("sbx_failed"),
        observedState: "failed",
        retention: { preserveFailed: true },
        gcAfter: "2020-01-01T00:00:00.000Z",
      });
      await store.put({
        ...record("sbx_old"),
        desiredState: "removed",
        observedState: "removed",
        gcAfter: "2020-01-01T00:00:00.000Z",
      });
      const decisions = await new SandboxGarbageCollector(store).collect(
        new Date("2026-01-01T00:00:00.000Z"),
      );
      assert.equal(
        decisions.find((d) => d.sandboxId === "sbx_failed")?.action,
        "none",
      );
      assert.equal(await store.get("sbx_old"), undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("adopts ECS orphans using sandbox id metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-orphan-ecs-"));
    try {
      const store = new FileManagerStore(dir);
      await store.put(record("sbx_ecs"));
      const driver = fakeDriver();
      const decisions = await new OrphanReconciler(store, driver).reconcile([
        {
          kind: "ecs",
          id: "task-arn",
          metadata: { sandboxId: "sbx_ecs" },
        },
      ]);
      assert.equal(decisions[0].action, "adopt");
      assert.equal((await store.get("sbx_ecs"))?.containerRef?.kind, "ecs");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("adopts matching orphans and stops unmanaged containers by policy", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nerve-orphan-"));
    try {
      const store = new FileManagerStore(dir);
      await store.put(record("sbx_1"));
      const driver = fakeDriver();
      const decisions = await new OrphanReconciler(store, driver).reconcile([
        { kind: "docker", id: "known", name: "nerve-sbx_1" },
        { kind: "docker", id: "unknown", name: "nerve-sbx_2" },
      ]);
      assert.equal(
        decisions.find((d) => d.ref.id === "known")?.action,
        "adopt",
      );
      assert.equal(
        decisions.find((d) => d.ref.id === "unknown")?.action,
        "stop",
      );
      assert.equal(
        decideOrphan({ kind: "docker", id: "x" }, new Set(), "remove").action,
        "remove",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function fakeDriver(
  status:
    | { state?: never; exitCode?: number }
    | { state: "exited"; exitCode?: number } = {},
): ContainerRuntimeDriver {
  return {
    kind: "fake",
    capabilities: () => ({
      kind: "fake",
      available: true,
      supportsReadOnlyRootFilesystem: true,
      supportsNoNewPrivileges: true,
      supportsPidsLimit: true,
      supportsCpuLimit: true,
      supportsMemoryLimit: true,
      supportsTmpfs: true,
      limitations: [],
    }),
    create: async () => ({ kind: "fake", id: "created" }),
    start: async () => undefined,
    inspect: async (ref) => ({
      ref,
      state: status.state ?? "running",
      exitCode: status.exitCode,
    }),
    logs: async function* (): AsyncIterable<LogChunk> {},
    stop: async () => undefined,
    kill: async () => undefined,
    remove: async () => undefined,
  };
}
