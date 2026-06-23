import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { TaskLogEvent, TaskRecord } from "@nerve/shared";
import { boundLiveOutputChunk } from "@nerve/tools";
import { isActiveTaskStatus } from "./index.js";
import type { ManagedTask, TaskManager } from "./task-manager.js";

const RUNTIME_TIMEOUT_FORCE_KILL_AFTER_MS = 5000;

export async function captureOutput(
  this: TaskManager,
  taskId: string,
  stream: "stdout" | "stderr",
  chunk: Buffer | string,
): Promise<void> {
  const record = this.tasks.get(taskId);
  const managed = this.managed.get(taskId);
  if (!record || !managed) return;
  managed.onOutput?.({
    kind: "output",
    stream,
    chunk: boundLiveOutputChunk(
      Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk,
    ),
  });
  await this.taskLogs.captureOutput(
    record,
    managed,
    stream,
    chunk,
    async (event) => this.checkReadiness(record.id, event),
  );
}

export async function flushTaskOutputBuffers(
  this: TaskManager,
  taskId: string,
): Promise<void> {
  const record = this.tasks.get(taskId);
  const managed = this.managed.get(taskId);
  if (!record || !managed) return;

  try {
    await this.taskLogs.flushOutputBuffers(record, managed, async (event) =>
      this.checkReadiness(record.id, event),
    );
  } catch (error) {
    await this.logger
      ?.warn("Task output flush failed", {
        taskId: record.id,
        projectId: record.projectId,
        conversationId: record.conversationId,
        agentId: record.agentId,
        error,
      })
      .catch(() => undefined);
  }
}

export async function checkReadiness(
  this: TaskManager,
  taskId: string,
  log: TaskLogEvent,
): Promise<void> {
  const record = this.tasks.get(taskId);
  const managed = this.managed.get(taskId);
  if (!record || !managed || record.readiness.outcome !== "pending") return;
  const matched = this.taskReadiness.match(
    record,
    managed.readinessPattern,
    log,
  );
  if (!matched) return;
  await this.markTaskReady(taskId, matched);
}

export async function markTaskReady(
  this: TaskManager,
  taskId: string,
  matched: string,
): Promise<void> {
  const record = this.tasks.get(taskId);
  const managed = this.managed.get(taskId);
  if (!record || !managed || record.readiness.outcome !== "pending") return;
  if (record.status === "stopping" || !isActiveTaskStatus(record.status))
    return;
  this.clearReadinessWatch(managed);
  const ready = await this.updateTask(taskId, {
    status: "ready",
    readiness: {
      ...record.readiness,
      outcome: "ready",
      matched,
      readyAt: new Date().toISOString(),
    },
  });
  await this.events.publish("task.ready", { task: ready, matched });
  await this.logger?.info("Task ready", {
    taskId: ready.id,
    projectId: ready.projectId,
    conversationId: ready.conversationId,
    agentId: ready.agentId,
    context: { matched },
  });
}

export function scheduleReadyUrlPolling(
  this: TaskManager,
  taskId: string,
): void {
  const record = this.tasks.get(taskId);
  if (!record?.readiness.readyUrl || record.readiness.outcome !== "pending") {
    return;
  }
  const managed = this.managed.get(taskId);
  if (!managed) return;
  managed.readinessPollAbort?.abort();
  const abort = new AbortController();
  managed.readinessPollAbort = abort;
  const readyUrl = record.readiness.readyUrl;
  void this.pollReadyUrl(taskId, readyUrl, abort.signal);
}

export async function pollReadyUrl(
  this: TaskManager,
  taskId: string,
  readyUrl: string,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    const record = this.tasks.get(taskId);
    if (record?.readiness.outcome !== "pending") return;
    if (await this.isReadyUrlReachable(readyUrl, signal)) {
      await this.markTaskReady(taskId, readyUrl);
      return;
    }
    try {
      await delay(250, undefined, { signal });
    } catch {
      return;
    }
  }
}

export async function isReadyUrlReachable(
  this: TaskManager,
  readyUrl: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    await fetch(readyUrl, { method: "GET", signal });
    return true;
  } catch (error) {
    if (signal.aborted) return false;
    if (error instanceof TypeError) return false;
    return false;
  }
}

export function clearReadinessWatch(
  this: TaskManager,
  managed: ManagedTask | undefined,
): void {
  if (!managed) return;
  if (managed.readinessTimer) clearTimeout(managed.readinessTimer);
  managed.readinessTimer = undefined;
  managed.readinessPollAbort?.abort();
  managed.readinessPollAbort = undefined;
}

export function scheduleReadinessTimeout(
  this: TaskManager,
  taskId: string,
): void {
  const record = this.tasks.get(taskId);
  if (record?.readiness.outcome !== "pending") return;
  const managed = this.managed.get(taskId);
  const timeoutMs = record.readiness.timeoutMs ?? 3000;
  if (!managed || timeoutMs <= 0) return;
  if (managed.readinessTimer) clearTimeout(managed.readinessTimer);
  managed.readinessTimer = setTimeout(() => {
    void this.markReadinessTimeout(taskId);
  }, timeoutMs);
}

export function scheduleRuntimeTimeout(
  this: TaskManager,
  taskId: string,
  timeoutMs: number | undefined,
): void {
  if (!timeoutMs || timeoutMs <= 0) return;
  const managed = this.managed.get(taskId);
  if (!managed) return;
  if (managed.runtimeTimer) clearTimeout(managed.runtimeTimer);
  managed.runtimeTimer = setTimeout(() => {
    void this.markRuntimeTimeout(taskId, timeoutMs);
  }, timeoutMs);
}

export async function markReadinessTimeout(
  this: TaskManager,
  taskId: string,
): Promise<void> {
  const record = this.tasks.get(taskId);
  if (record?.readiness.outcome !== "pending") return;
  this.clearReadinessWatch(this.managed.get(taskId));
  const updated = await this.updateTask(taskId, {
    readiness: { ...record.readiness, outcome: "timeout" },
  });
  await this.events.publish("task.ready_timeout", { task: updated });
  await this.logger?.warn("Task readiness timed out", {
    taskId: updated.id,
    projectId: updated.projectId,
    conversationId: updated.conversationId,
    agentId: updated.agentId,
    context: { timeoutMs: updated.readiness.timeoutMs },
  });
}

export async function markRuntimeTimeout(
  this: TaskManager,
  taskId: string,
  timeoutMs: number,
): Promise<void> {
  const record = this.tasks.get(taskId);
  const managed = this.managed.get(taskId);
  if (!record || !managed?.child || !isActiveTaskStatus(record.status)) return;
  managed.timedOut = true;
  this.clearReadinessWatch(managed);
  const error = `Task exceeded maximum runtime of ${timeoutMs}ms.`;
  const stopping = await this.updateTask(taskId, {
    status: "stopping",
    error,
  });
  await this.logger?.warn("Task runtime timed out", {
    taskId: stopping.id,
    projectId: stopping.projectId,
    conversationId: stopping.conversationId,
    agentId: stopping.agentId,
    context: { timeoutMs },
  });
  void this.requestTermination(stopping, managed.child, "SIGTERM", error);
  setTimeout(() => {
    const latest = this.tasks.get(taskId);
    if (!latest || !isActiveTaskStatus(latest.status)) return;
    void this.requestTermination(
      latest,
      managed.child as ChildProcess,
      "SIGKILL",
      error,
    );
    void this.forceFinalizeTimedOutTask(taskId, "SIGKILL", error);
  }, RUNTIME_TIMEOUT_FORCE_KILL_AFTER_MS);
}

export async function requestTermination(
  this: TaskManager,
  record: TaskRecord,
  child: ChildProcess,
  signal: NodeJS.Signals,
  reason: string,
): Promise<void> {
  try {
    const result = await this.supervisor.terminate(child, signal);
    if (!result.error) return;
    if (this.logger) {
      await this.logger
        .warn("Task termination reported an error", {
          taskId: record.id,
          projectId: record.projectId,
          conversationId: record.conversationId,
          agentId: record.agentId,
          context: {
            signal,
            reason,
            method: result.method,
            error: result.error,
          },
        })
        .catch(() => undefined);
    }
  } catch (error) {
    if (this.logger) {
      await this.logger
        .warn("Task termination failed", {
          taskId: record.id,
          projectId: record.projectId,
          conversationId: record.conversationId,
          agentId: record.agentId,
          error,
          context: { signal, reason },
        })
        .catch(() => undefined);
    }
  }
}
