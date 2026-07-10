import type { TaskRecord } from "@nervekit/contracts";
import { isActiveTaskStatus } from "./index.js";
import type { TaskManager } from "./task-manager.js";

export async function forceFinalizeCancelledTask(
  this: TaskManager,
  taskId: string,
  signal: NodeJS.Signals,
  reason: string,
): Promise<TaskRecord> {
  const record = this.getTask(taskId);
  if (!isActiveTaskStatus(record.status)) return record;

  const managed = this.managed.get(taskId);
  this.clearReadinessWatch(managed);
  if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);
  if (managed) managed.finalized = true;

  await this.flushTaskOutputBuffers(taskId);

  const freshRecord = this.tasks.get(taskId) ?? record;
  const readiness =
    freshRecord.readiness.outcome === "pending"
      ? { ...freshRecord.readiness, outcome: "exited" as const }
      : freshRecord.readiness;
  const updated = await this.updateTask(taskId, {
    status: "cancelled",
    readiness,
    finishedAt: new Date().toISOString(),
    exitCode: null,
    signal,
  });
  this.resolveManagedTerminal(taskId, updated);
  this.managed.delete(taskId);
  await this.events.publish("task.cancelled", { task: updated });
  await this.logger?.warn("Task stop force-finalized", {
    taskId: updated.id,
    projectId: updated.projectId,
    conversationId: updated.conversationId,
    agentId: updated.agentId,
    context: { signal, reason },
  });
  return updated;
}

export async function forceFinalizeTimedOutTask(
  this: TaskManager,
  taskId: string,
  signal: NodeJS.Signals,
  reason: string,
): Promise<TaskRecord> {
  const record = this.getTask(taskId);
  if (!isActiveTaskStatus(record.status)) return record;

  const managed = this.managed.get(taskId);
  this.clearReadinessWatch(managed);
  if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);
  if (managed) managed.finalized = true;

  await this.flushTaskOutputBuffers(taskId);

  const freshRecord = this.tasks.get(taskId) ?? record;
  const readiness =
    freshRecord.readiness.outcome === "pending"
      ? { ...freshRecord.readiness, outcome: "exited" as const }
      : freshRecord.readiness;
  const updated = await this.updateTask(taskId, {
    status: "timed_out",
    readiness,
    finishedAt: new Date().toISOString(),
    exitCode: null,
    signal,
    error: freshRecord.error ?? reason,
  });
  this.resolveManagedTerminal(taskId, updated);
  this.managed.delete(taskId);
  await this.events.publish("task.timed_out", { task: updated });
  await this.logger?.warn("Task timeout force-finalized", {
    taskId: updated.id,
    projectId: updated.projectId,
    conversationId: updated.conversationId,
    agentId: updated.agentId,
    context: { signal, reason },
  });
  return updated;
}

export async function markTaskExited(
  this: TaskManager,
  taskId: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): Promise<TaskRecord | undefined> {
  const record = this.tasks.get(taskId);
  const managed = this.managed.get(taskId);
  if (!record) return undefined;
  if (!isActiveTaskStatus(record.status)) return record;
  if (managed?.finalized) return record;
  this.clearReadinessWatch(managed);
  if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);
  if (managed) managed.finalized = true;

  await this.flushTaskOutputBuffers(taskId);

  const freshRecord = this.tasks.get(taskId);
  if (!freshRecord) return undefined;
  if (!isActiveTaskStatus(freshRecord.status)) return freshRecord;

  const status = managed?.timedOut
    ? "timed_out"
    : managed?.stopping
      ? "cancelled"
      : exitCode === 0
        ? "completed"
        : "failed";
  const readiness =
    freshRecord.readiness.outcome === "pending"
      ? { ...freshRecord.readiness, outcome: "exited" as const }
      : freshRecord.readiness;
  const updated = await this.updateTask(taskId, {
    status,
    readiness,
    finishedAt: new Date().toISOString(),
    exitCode,
    signal,
    error: freshRecord.error,
  });
  this.resolveManagedTerminal(taskId, updated);
  this.managed.delete(taskId);
  await this.events.publish(`task.${status}`, { task: updated });
  await this.logger?.[
    status === "failed" || status === "timed_out" ? "error" : "info"
  ]("Task exited", {
    taskId: updated.id,
    projectId: updated.projectId,
    conversationId: updated.conversationId,
    agentId: updated.agentId,
    context: { exitCode, signal, status },
  });
  return updated;
}

export async function markTaskError(
  this: TaskManager,
  taskId: string,
  message: string,
): Promise<void> {
  const record = this.tasks.get(taskId);
  const managed = this.managed.get(taskId);
  if (!record || !isActiveTaskStatus(record.status)) return;
  if (managed?.finalized) return;
  this.clearReadinessWatch(managed);
  if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);
  if (managed) managed.finalized = true;

  await this.flushTaskOutputBuffers(taskId);

  const freshRecord = this.tasks.get(taskId);
  if (!freshRecord || !isActiveTaskStatus(freshRecord.status)) return;

  const readiness =
    freshRecord.readiness.outcome === "pending"
      ? { ...freshRecord.readiness, outcome: "exited" as const }
      : freshRecord.readiness;
  const updated = await this.updateTask(taskId, {
    status: "failed",
    readiness,
    finishedAt: new Date().toISOString(),
    error: message,
  });
  this.resolveManagedTerminal(taskId, updated);
  this.managed.delete(taskId);
  await this.events.publish("task.failed", { task: updated, message });
  await this.logger?.error("Task error", {
    taskId: updated.id,
    projectId: updated.projectId,
    conversationId: updated.conversationId,
    agentId: updated.agentId,
    context: { message },
  });
}

export function resolveManagedTerminal(
  this: TaskManager,
  taskId: string,
  task: TaskRecord | undefined,
): void {
  const managed = this.managed.get(taskId);
  if (!managed?.resolveTerminal) return;
  managed.resolveTerminal(task);
  managed.resolveTerminal = undefined;
}
