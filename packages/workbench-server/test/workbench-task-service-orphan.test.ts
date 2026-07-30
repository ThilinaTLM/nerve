import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createManager,
  fakeSupervisor,
  runtimeMetadata,
  seedTaskRecord,
} from "./helpers/workbench-task-service.js";

describe("task manager orphan cleanup", () => {
  it("cleans up an orphaned record with runtime metadata", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => false,
    });
    const { manager, storage, events } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id);

    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.exitCode, null);
    assert.equal(
      stopped.signal,
      process.platform === "win32" ? "SIGKILL" : "SIGTERM",
    );
    assert.deepEqual(
      runtimeTerminateSignals,
      process.platform === "win32" ? ["SIGKILL"] : ["SIGTERM"],
    );
    assert.ok(
      (await events.readStream("workspace", 1, 5_000)).events.some(
        (event) => event.type === "task.cancelled",
      ),
    );
  });

  it("cleans a recovered runtime instead of leaving it stopping", async () => {
    const runtime = runtimeMetadata();
    let alive = true;
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => alive,
      onTerminateRuntime() {
        alive = false;
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, {
      runtime,
      status: "recovered",
      finishedAt: undefined,
    });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id);

    assert.equal(stopped.status, "cancelled");
    assert.deepEqual(
      runtimeTerminateSignals,
      process.platform === "win32" ? ["SIGKILL"] : ["SIGTERM"],
    );
  });

  it("force-kills a recovered runtime immediately", async () => {
    const runtime = runtimeMetadata();
    let alive = true;
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => alive,
      onTerminateRuntime() {
        alive = false;
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, {
      runtime,
      status: "recovered",
      finishedAt: undefined,
    });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id, { signal: "SIGKILL" });

    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.signal, "SIGKILL");
    assert.deepEqual(runtimeTerminateSignals, ["SIGKILL"]);
  });

  it("force-cleans a legacy unmanaged stopping record", async () => {
    const runtime = runtimeMetadata();
    let alive = true;
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => alive,
      onTerminateRuntime() {
        alive = false;
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, {
      runtime,
      status: "recovered",
      finishedAt: undefined,
    });
    await manager.hydrate();
    await manager.updateTask(record.id, { status: "stopping" });

    const stopped = await manager.cancelTask(record.id, { signal: "SIGKILL" });

    assert.equal(stopped.status, "cancelled");
    assert.deepEqual(runtimeTerminateSignals, ["SIGKILL"]);
  });

  it("escalates orphan cleanup on POSIX and force-cleans on Windows", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => true,
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id, { timeoutMs: 20 });

    assert.equal(stopped.status, "cancelled");
    assert.equal(stopped.signal, "SIGKILL");
    assert.deepEqual(
      runtimeTerminateSignals,
      process.platform === "win32" ? ["SIGKILL"] : ["SIGTERM", "SIGKILL"],
    );
  });

  it("uses the platform cleanup signal when the target disappears", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => false,
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id, { timeoutMs: 100 });

    assert.equal(stopped.status, "cancelled");
    assert.equal(
      stopped.signal,
      process.platform === "win32" ? "SIGKILL" : "SIGTERM",
    );
    assert.deepEqual(
      runtimeTerminateSignals,
      process.platform === "win32" ? ["SIGKILL"] : ["SIGTERM"],
    );
  });

  it("records released ports after orphan cleanup", async () => {
    const listeningPort = {
      protocol: "tcp" as const,
      address: "127.0.0.1",
      port: 34567,
      pid: 1234,
      processGroupId: process.platform === "win32" ? undefined : 1234,
      processStartTimeTicks: 999,
      detectedAt: "2026-01-02T03:04:06.000Z",
    };
    const runtime = runtimeMetadata({ listeningPorts: [listeningPort] });
    const { supervisor } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => false,
      inspectPortListeners: () => [],
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id);

    assert.deepEqual(
      stopped.lastOrphanCleanupReleasedPorts,
      process.platform === "win32" ? [] : [listeningPort],
    );
  });

  it("does not report a released port when a different process owns it", async () => {
    const listeningPort = {
      protocol: "tcp" as const,
      address: "127.0.0.1",
      port: 34568,
      pid: 1234,
      processGroupId: process.platform === "win32" ? undefined : 1234,
      processStartTimeTicks: 999,
      detectedAt: "2026-01-02T03:04:06.000Z",
    };
    const otherOwner = {
      ...listeningPort,
      pid: 4321,
      processGroupId: process.platform === "win32" ? undefined : 4321,
      processStartTimeTicks: 1000,
    };
    const runtime = runtimeMetadata({ listeningPorts: [listeningPort] });
    const { supervisor } = fakeSupervisor({
      runtime,
      isRuntimeTargetAlive: () => false,
      inspectPortListeners: () => [otherOwner],
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const stopped = await manager.cancelTask(record.id);

    assert.deepEqual(stopped.lastOrphanCleanupReleasedPorts, []);
  });

  it("keeps old orphaned records without runtime metadata and surfaces an error", async () => {
    const { supervisor } = fakeSupervisor({});
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime: undefined });
    await manager.hydrate();

    await assert.rejects(
      () => manager.cancelTask(record.id),
      /no PID metadata was captured/,
    );

    const stored = manager.getTask(record.id);
    assert.equal(stored.status, "orphaned");
    assert.match(stored.error ?? "", /no PID metadata was captured/);
  });

  it("keeps platform-mismatched orphaned records and surfaces an error", async () => {
    const mismatchedPlatform = process.platform === "win32" ? "linux" : "win32";
    const runtime = runtimeMetadata({
      platform: mismatchedPlatform,
      detached: mismatchedPlatform !== "win32",
      processGroupId: mismatchedPlatform === "win32" ? undefined : 1234,
    });
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({ runtime });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    await assert.rejects(
      () => manager.cancelTask(record.id),
      new RegExp(`spawned on ${mismatchedPlatform} from ${process.platform}`),
    );

    const stored = manager.getTask(record.id);
    assert.equal(stored.status, "orphaned");
    assert.match(stored.error ?? "", /Cannot clean up task spawned/);
    assert.deepEqual(runtimeTerminateSignals, []);
  });

  it("cleans an orphaned task before restarting", async () => {
    const order: string[] = [];
    const runtime = runtimeMetadata({ childPid: 1234, processGroupId: 1234 });
    const replacementRuntime = runtimeMetadata({
      childPid: 9876,
      processGroupId: 9876,
      spawnedAt: "2026-01-02T03:05:05.000Z",
    });
    const { supervisor, runtimeTerminateSignals, spawnCommands } =
      fakeSupervisor({
        runtime: replacementRuntime,
        isRuntimeTargetAlive: () => false,
        onTerminateRuntime(_runtime, signal) {
          order.push(`terminateRuntime:${signal}`);
        },
        onSpawn() {
          order.push("spawn");
        },
      });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    const restarted = await manager.restartTask(record.id);

    const cleanupSignal = process.platform === "win32" ? "SIGKILL" : "SIGTERM";
    assert.deepEqual(order, [`terminateRuntime:${cleanupSignal}`, "spawn"]);
    assert.deepEqual(runtimeTerminateSignals, [cleanupSignal]);
    assert.equal(manager.getTask(record.id).status, "cancelled");
    assert.equal(restarted.restartedFromTaskId, record.id);
    assert.equal(spawnCommands.length, 1);
  });

  it("force-kills every verified active runtime during shutdown despite failures", async () => {
    const firstRuntime = runtimeMetadata({
      childPid: 1234,
      processGroupId: 1234,
    });
    const secondRuntime = runtimeMetadata({
      childPid: 5678,
      processGroupId: 5678,
    });
    const alive = new Set([1234, 5678]);
    const { supervisor, runtimeTerminateSignals } = fakeSupervisor({
      isRuntimeTargetAlive: (runtime) => alive.has(runtime.childPid ?? -1),
      onTerminateRuntime(runtime) {
        if (runtime.childPid === 1234)
          throw new Error("injected shutdown failure");
        alive.delete(runtime.childPid ?? -1);
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const first = await seedTaskRecord(storage, {
      runtime: firstRuntime,
      status: "recovered",
      finishedAt: undefined,
    });
    const second = await seedTaskRecord(storage, {
      runtime: secondRuntime,
      status: "recovered",
      finishedAt: undefined,
    });
    await manager.hydrate();

    await manager.shutdown();

    assert.equal(runtimeTerminateSignals.length, 2);
    assert.equal(manager.getTask(first.id).status, "recovered");
    assert.equal(manager.getTask(second.id).status, "cancelled");
  });

  it("does not start a duplicate task when orphan cleanup fails", async () => {
    const runtime = runtimeMetadata();
    const { supervisor, spawnCommands } = fakeSupervisor({
      runtime,
      onTerminateRuntime() {
        return { attempted: false, method: "none", error: "cleanup failed" };
      },
    });
    const { manager, storage } = await createManager(supervisor);
    const record = await seedTaskRecord(storage, { runtime });
    await manager.hydrate();

    await assert.rejects(
      () => manager.restartTask(record.id),
      /cleanup failed/,
    );

    assert.equal(manager.getTask(record.id).status, "orphaned");
    assert.equal(spawnCommands.length, 0);
  });
});
