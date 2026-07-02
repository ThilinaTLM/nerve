import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
