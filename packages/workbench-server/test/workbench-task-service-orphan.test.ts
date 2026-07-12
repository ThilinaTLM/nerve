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
    assert.equal(stopped.signal, "SIGTERM");
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
    assert.ok(
      events.replaySince(0).some((event) => event.type === "task.cancelled"),
    );
  });

  it("escalates orphan cleanup to SIGKILL after timeout on non-Windows", async () => {
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
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM", "SIGKILL"]);
  });

  it("does not escalate orphan cleanup when the target disappears", async () => {
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
    assert.equal(stopped.signal, "SIGTERM");
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
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

    assert.deepEqual(order, ["terminateRuntime:SIGTERM", "spawn"]);
    assert.deepEqual(runtimeTerminateSignals, ["SIGTERM"]);
    assert.equal(manager.getTask(record.id).status, "cancelled");
    assert.equal(restarted.restartedFromTaskId, record.id);
    assert.equal(spawnCommands.length, 1);
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
