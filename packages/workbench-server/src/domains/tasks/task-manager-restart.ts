import type { TaskRecord } from "@nervekit/contracts";
import type { TaskManager } from "./task-manager.js";
import { spawnManagedTaskRun } from "./task-manager-start.js";

export async function restartActiveTaskInPlace(
  this: TaskManager,
  record: TaskRecord,
  env: Record<string, string> | undefined,
): Promise<TaskRecord> {
  const managed = this.managed.get(record.id);
  if (!managed?.child) return record;

  managed.stopping = true;
  managed.finalized = true;
  this.clearReadinessWatch(managed);
  if (managed.runtimeTimer) clearTimeout(managed.runtimeTimer);
  await this.flushTaskOutputBuffers(record.id);

  const signal: NodeJS.Signals = "SIGTERM";
  const stopping = await this.updateTask(record.id, { status: "stopping" });
  await this.events.publish("task.stop_requested", {
    task: stopping,
    signal,
    reason: "restart requested",
  });
  await this.logger?.info("Task restart stop requested", {
    taskId: record.id,
    projectId: record.projectId,
    conversationId: record.conversationId,
    agentId: record.agentId,
    context: { signal, restart: true },
  });

  void this.requestTermination(
    stopping,
    managed.child,
    signal,
    "restart requested",
  );

  const timeoutMs = 5000;
  const timeoutResult = Symbol("task-restart-stop-timeout");
  let timeout: NodeJS.Timeout | undefined;
  const closed = await Promise.race<
    | { exitCode: number | null; signal: NodeJS.Signals | null }
    | typeof timeoutResult
  >([
    managed.closePromise ?? Promise.resolve(timeoutResult),
    new Promise<typeof timeoutResult>((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout(timeoutResult), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });

  if (closed === timeoutResult) {
    void this.requestTermination(
      this.tasks.get(record.id) ?? stopping,
      managed.child,
      "SIGKILL",
      `restart stop timed out after ${timeoutMs}ms`,
    );
  }

  this.resolveManagedTerminal(record.id, undefined);
  if (this.managed.get(record.id) === managed) {
    this.managed.delete(record.id);
  }

  const previous = this.tasks.get(record.id) ?? record;
  const now = new Date().toISOString();
  const reset: TaskRecord = {
    ...previous,
    status: "starting",
    readiness: this.taskReadiness.buildReadiness({
      cwd: previous.cwd,
      command: previous.command,
      readyUrl: previous.readiness.readyUrl,
      readyOnUrl: previous.readiness.readyOnUrl,
      readyPattern: previous.readiness.readyPattern,
      readyTimeoutMs: previous.readiness.timeoutMs,
    }),
    startedAt: now,
    updatedAt: now,
    finishedAt: undefined,
    exitCode: undefined,
    signal: undefined,
    error: undefined,
    runtime: undefined,
    restartedFromTaskId: previous.restartedFromTaskId,
    restartRootTaskId: previous.restartRootTaskId ?? previous.id,
    restartGeneration: (previous.restartGeneration ?? 0) + 1,
    completion: previous.completion
      ? { ...previous.completion, entryId: undefined, injectedAt: undefined }
      : undefined,
    notifications: previous.notifications
      ? {
          ...previous.notifications,
          readyEntryId: undefined,
          terminalEntryId: undefined,
          readyDeliveredAt: undefined,
          terminalDeliveredAt: undefined,
        }
      : undefined,
  };
  await this.upsertTask(reset);
  return await spawnManagedTaskRun.call(this, reset, { env });
}
