import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { TaskRecord } from "@nervekit/contracts/tasks";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";

test("runtime shutdown awaits detached task event storage work before canonical close", async () => {
  const home = await mkdtemp(
    join(tmpdir(), "nerve-task-notification-shutdown-"),
  );
  const storage = await initializeStorage(home);
  const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let closed = false,
    delivered = 0,
    readsAfterClose = 0;
  const close = storage.canonicalStore.close.bind(storage.canonicalStore);
  storage.canonicalStore.close = async () => {
    assert.equal(
      delivered,
      1,
      "canonical store closed before task event insertion",
    );
    closed = true;
    await close();
  };
  try {
    await runtime.lifecycle.hydrate();
    const project = await runtime.services.projectLifecycle.createProject({
      dir: home,
    });
    const conversation =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const now = new Date().toISOString();
    // A legacy/UI task still appends through the real durable bootstrap adapter.
    // Only its external task-source reads are replaced with a deterministic barrier.
    const task: TaskRecord = {
      id: "task_shutdown",
      projectId: project.id,
      conversationId: conversation.id,
      cwd: home,
      command: "printf complete",
      status: "completed",
      readiness: { outcome: "none" },
      stdoutPath: join(home, "stdout.log"),
      stderrPath: join(home, "stderr.log"),
      logsPath: join(home, "logs.jsonl"),
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
      exitCode: 0,
      origin: {
        kind: "agent_tool",
        toolCallId: "tool_shutdown",
        runId: "run_shutdown",
      },
      notifications: {
        enabled: true,
        ready: true,
        terminal: true,
        outputTailLineCount: 3,
      },
      visibility: "background",
    };
    const tasks = runtime.services.tasks;
    const get = tasks.getTask.bind(tasks),
      logs = tasks.queryLogs.bind(tasks);
    const pending = tasks.markNotificationPending.bind(tasks),
      receipt = tasks.markNotificationDelivered.bind(tasks);
    tasks.getTask = (id) => (id === task.id ? task : get(id));
    tasks.markNotificationPending = async (...args) => {
      if (args[0] !== task.id) return pending(...args);
      assert.equal(closed, false);
      task.notifications!.terminalEntryId = args[2];
    };
    tasks.queryLogs = async (...args) => {
      if (args[0] !== task.id) return logs(...args);
      if (closed) readsAfterClose++;
      enter();
      await barrier;
      assert.equal(
        closed,
        false,
        "task log operation continued after canonical close",
      );
      return { events: [], nextCursor: 0 };
    };
    tasks.markNotificationDelivered = async (...args) => {
      if (args[0] !== task.id) return receipt(...args);
      assert.equal(closed, false, "task receipt wrote after canonical close");
      delivered++;
      task.notifications!.terminalDeliveredAt = args[3];
    };
    await runtime.runtime.events.publish("task.completed", { task });
    await entered;
    const shutdown = shutdownServerRuntime(runtime.runtime);
    await delay(20);
    assert.equal(closed, false);
    assert.equal(delivered, 0);
    release();
    await shutdown;
    assert.equal(closed, true);
    await delay(60);
    assert.equal(readsAfterClose, 0);
    assert.equal(delivered, 1);
  } finally {
    release();
    if (!closed) {
      // Do not let an assertion in close prevent best-effort fixture cleanup.
      storage.canonicalStore.close = close;
      await shutdownServerRuntime(runtime.runtime);
    }
    await rm(home, { recursive: true, force: true });
  }
});
