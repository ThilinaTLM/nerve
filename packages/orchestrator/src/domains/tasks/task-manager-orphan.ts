import type { CancelTaskRequest, TaskRecord, TaskRuntime } from "@nerve/shared";
import type { TaskManager } from "./task-manager.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function markHydratedRecordOrphaned(
  this: TaskManager,
  record: TaskRecord,
): TaskRecord {
  const now = new Date().toISOString();
  const foregroundAgentTask =
    record.visibility === "foreground" && record.origin.kind === "agent_tool";
  return {
    ...record,
    status: "orphaned",
    visibility: foregroundAgentTask ? "background" : record.visibility,
    completion: foregroundAgentTask
      ? {
          ...record.completion,
          inject: true,
          outputTailLineCount: record.completion?.outputTailLineCount ?? 80,
        }
      : record.completion,
    notifications: foregroundAgentTask
      ? {
          enabled: true,
          ready: false,
          terminal: true,
          outputTailLineCount:
            record.notifications?.outputTailLineCount ??
            record.completion?.outputTailLineCount ??
            80,
        }
      : record.notifications,
    error: this.orphanedHydrateMessage(record.runtime),
    finishedAt: now,
    updatedAt: now,
  };
}

export function orphanedHydrateMessage(
  this: TaskManager,
  runtime: TaskRuntime | undefined,
): string {
  if (runtime?.childPid) {
    return `Task supervision was lost after daemon restart. Use task_cancel to attempt cleanup of PID ${runtime.childPid}.`;
  }
  if (runtime?.processGroupId) {
    return `Task supervision was lost after daemon restart. Use task_cancel to attempt cleanup of process group ${runtime.processGroupId}.`;
  }
  return "Task supervision was lost after daemon restart, and no PID metadata was captured.";
}

export async function cleanupOrphanedTask(
  this: TaskManager,
  taskId: string,
  request: CancelTaskRequest,
): Promise<TaskRecord> {
  const record = this.getTask(taskId);
  if (record.status !== "orphaned") return record;

  const validationError = this.orphanCleanupValidationError(record.runtime);
  if (validationError) {
    await this.failOrphanCleanup(record, validationError);
  }
  const runtime = record.runtime as TaskRuntime;
  const initialSignal = request.signal ?? "SIGTERM";
  const timeoutMs = request.timeoutMs ?? 5000;

  await this.events.publish("task.stop_requested", {
    taskId: record.id,
    signal: initialSignal,
    orphaned: true,
  });
  await this.logger?.info("Orphaned task cleanup requested", {
    taskId: record.id,
    projectId: record.projectId,
    conversationId: record.conversationId,
    agentId: record.agentId,
    context: this.runtimeLogContext(runtime, { signal: initialSignal }),
  });

  if (runtime.platform === "win32") {
    const result = await this.terminateRuntimeForCleanup(
      record,
      runtime,
      "SIGKILL",
    );
    if (!result.attempted || result.error) {
      await this.failOrphanCleanup(
        record,
        result.error ?? "Could not clean up orphaned task runtime target.",
        { method: result.method, signal: "SIGKILL" },
      );
    }
    return this.finalizeOrphanCleanup(record.id, "SIGKILL", runtime, {
      method: result.method,
    });
  }

  const initialResult = await this.terminateRuntimeForCleanup(
    record,
    runtime,
    initialSignal,
  );
  if (!initialResult.attempted || initialResult.method === "none") {
    await this.failOrphanCleanup(
      record,
      initialResult.error ?? "Could not signal orphaned task runtime target.",
      { method: initialResult.method, signal: initialSignal },
    );
  }
  if (initialResult.error) {
    await this.logger?.warn("Orphaned task cleanup signal reported an error", {
      taskId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      context: this.runtimeLogContext(runtime, {
        signal: initialSignal,
        method: initialResult.method,
        error: initialResult.error,
      }),
    });
  }

  let finalSignal = initialSignal;
  if (!(await this.waitForRuntimeTargetExit(runtime, timeoutMs))) {
    finalSignal = "SIGKILL";
    const killResult = await this.terminateRuntimeForCleanup(
      record,
      runtime,
      finalSignal,
    );
    if (!killResult.attempted || killResult.method === "none") {
      await this.failOrphanCleanup(
        record,
        killResult.error ??
          "Could not force-kill orphaned task runtime target.",
        { method: killResult.method, signal: finalSignal },
      );
    }
    if (killResult.error && (await this.isRuntimeTargetAlive(runtime))) {
      await this.failOrphanCleanup(record, killResult.error, {
        method: killResult.method,
        signal: finalSignal,
      });
    }
  }

  return this.finalizeOrphanCleanup(record.id, finalSignal, runtime);
}

export function orphanCleanupValidationError(
  this: TaskManager,
  runtime: TaskRuntime | undefined,
): string | undefined {
  if (!runtime) {
    return "Cannot clean up orphaned task because no PID metadata was captured.";
  }
  if (runtime.platform !== process.platform) {
    return `Cannot clean up task spawned on ${runtime.platform} from ${process.platform}.`;
  }
  if (runtime.platform === "win32" && !runtime.childPid) {
    return "Cannot clean up orphaned task because no child PID metadata was captured.";
  }
  if (
    runtime.platform !== "win32" &&
    !runtime.processGroupId &&
    !runtime.childPid
  ) {
    return "Cannot clean up orphaned task because no process-group or child PID metadata was captured.";
  }
  return undefined;
}

export async function terminateRuntimeForCleanup(
  this: TaskManager,
  record: TaskRecord,
  runtime: TaskRuntime,
  signal: NodeJS.Signals,
) {
  try {
    return await this.supervisor.terminateRuntime(runtime, signal);
  } catch (error) {
    await this.logger?.warn("Orphaned task cleanup termination threw", {
      taskId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      error,
      context: this.runtimeLogContext(runtime, { signal }),
    });
    return {
      attempted: false,
      method: "none" as const,
      error: this.errorMessage(error),
    };
  }
}

export async function waitForRuntimeTargetExit(
  this: TaskManager,
  runtime: TaskRuntime,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    if (!(await this.isRuntimeTargetAlive(runtime))) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await delay(Math.min(50, remaining));
  }
}

export async function isRuntimeTargetAlive(
  this: TaskManager,
  runtime: TaskRuntime,
): Promise<boolean> {
  try {
    return await this.supervisor.isRuntimeTargetAlive(runtime);
  } catch (error) {
    await this.logger?.warn("Orphaned task liveness check failed", {
      error,
      context: this.runtimeLogContext(runtime),
    });
    return true;
  }
}

export async function finalizeOrphanCleanup(
  this: TaskManager,
  taskId: string,
  finalSignal: NodeJS.Signals,
  runtime: TaskRuntime,
  context: Record<string, unknown> = {},
): Promise<TaskRecord> {
  const record = this.getTask(taskId);
  if (record.status !== "orphaned") return record;
  const managed = this.managed.get(taskId);
  this.clearReadinessWatch(managed);
  if (managed?.runtimeTimer) clearTimeout(managed.runtimeTimer);

  const readiness =
    record.readiness.outcome === "pending"
      ? { ...record.readiness, outcome: "exited" as const }
      : record.readiness;
  const updated = await this.updateTask(taskId, {
    status: "cancelled",
    readiness,
    finishedAt: new Date().toISOString(),
    exitCode: null,
    signal: finalSignal,
    error: undefined,
  });
  this.managed.delete(taskId);
  await this.events.publish("task.cancelled", { task: updated });
  await this.events.publish("task.orphan_cleanup_succeeded", {
    task: updated,
    runtime,
    signal: finalSignal,
    ...context,
  });
  await this.logger?.info("Orphaned task cleanup completed", {
    taskId: updated.id,
    projectId: updated.projectId,
    conversationId: updated.conversationId,
    agentId: updated.agentId,
    context: this.runtimeLogContext(runtime, {
      signal: finalSignal,
      ...context,
    }),
  });
  return updated;
}

export async function failOrphanCleanup(
  this: TaskManager,
  record: TaskRecord,
  message: string,
  context: Record<string, unknown> = {},
): Promise<never> {
  const updated = await this.updateTask(record.id, { error: message });
  await this.events.publish("task.cleanup_failed", {
    task: updated,
    error: message,
    orphaned: true,
    ...context,
  });
  await this.logger?.warn("Orphaned task cleanup failed", {
    taskId: updated.id,
    projectId: updated.projectId,
    conversationId: updated.conversationId,
    agentId: updated.agentId,
    context: this.runtimeLogContext(updated.runtime, {
      error: message,
      ...context,
    }),
  });
  throw new Error(message);
}

export function runtimeLogContext(
  this: TaskManager,
  runtime: TaskRuntime | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    pid: runtime?.childPid,
    processGroupId: runtime?.processGroupId,
    platform: runtime?.platform,
    detached: runtime?.detached,
    shell: runtime?.shell,
    spawnedAt: runtime?.spawnedAt,
    ...extra,
  };
}

export function errorMessage(this: TaskManager, error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
