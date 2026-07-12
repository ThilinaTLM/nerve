import type {
  CancelTaskRequest,
  TaskListeningPort,
  TaskRecord,
  TaskRuntime,
} from "@nervekit/contracts";
import type { WorkbenchTaskService } from "./workbench-task-service.js";
import {
  dedupeListeningPorts,
  formatListeningPort,
  isSameProcessIdentity,
} from "./task-port-inspector.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export function markHydratedRecordOrphaned(
  this: WorkbenchTaskService,
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
  this: WorkbenchTaskService,
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
  this: WorkbenchTaskService,
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
  const cleanupPorts = await this.listeningPortsForOrphanCleanup(
    record,
    runtime,
  );
  const timeoutMs = request.timeoutMs ?? 5000;

  await this.events.publish("task.stop_requested", {
    task: record,
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
    const releasedPorts = await this.releaseOrphanedListeningPorts(
      record,
      cleanupPorts,
    );
    return this.finalizeOrphanCleanup(record.id, "SIGKILL", runtime, {
      method: result.method,
      releasedPorts,
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

  const releasedPorts = await this.releaseOrphanedListeningPorts(
    record,
    cleanupPorts,
  );
  return this.finalizeOrphanCleanup(record.id, finalSignal, runtime, {
    releasedPorts,
  });
}

export function orphanCleanupValidationError(
  this: WorkbenchTaskService,
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
  this: WorkbenchTaskService,
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
  this: WorkbenchTaskService,
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
  this: WorkbenchTaskService,
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

export async function listeningPortsForOrphanCleanup(
  this: WorkbenchTaskService,
  record: TaskRecord,
  runtime: TaskRuntime,
): Promise<TaskListeningPort[]> {
  const persisted = runtime.listeningPorts ?? [];
  try {
    const detected =
      await this.supervisor.inspectRuntimeListeningPorts(runtime);
    return dedupeListeningPorts([...persisted, ...detected]);
  } catch (error) {
    await this.logger?.warn("Orphaned task listening-port inspection failed", {
      taskId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      error,
      context: this.runtimeLogContext(runtime),
    });
    return dedupeListeningPorts(persisted);
  }
}

export async function releaseOrphanedListeningPorts(
  this: WorkbenchTaskService,
  record: TaskRecord,
  cleanupPorts: TaskListeningPort[],
): Promise<TaskListeningPort[]> {
  if (cleanupPorts.length === 0 || process.platform === "win32") return [];
  let current = await this.inspectPortListenersForCleanup(record, cleanupPorts);
  const killedPids = new Set<number>();
  for (const expected of cleanupPorts) {
    for (const actual of current) {
      if (!isSameProcessIdentity(expected, actual) || !actual.pid) continue;
      if (killedPids.has(actual.pid)) continue;
      killedPids.add(actual.pid);
      try {
        process.kill(actual.pid, "SIGKILL");
        await this.logger?.warn("Released orphaned task listening port", {
          taskId: record.id,
          projectId: record.projectId,
          conversationId: record.conversationId,
          agentId: record.agentId,
          context: {
            port: formatListeningPort(actual),
            pid: actual.pid,
            processGroupId: actual.processGroupId,
          },
        });
      } catch (error) {
        await this.logger?.warn(
          "Failed to release orphaned task listening port",
          {
            taskId: record.id,
            projectId: record.projectId,
            conversationId: record.conversationId,
            agentId: record.agentId,
            error,
            context: {
              port: formatListeningPort(actual),
              pid: actual.pid,
              processGroupId: actual.processGroupId,
            },
          },
        );
      }
    }
  }
  if (killedPids.size > 0) await delay(100);
  current = await this.inspectPortListenersForCleanup(record, cleanupPorts);
  return dedupeListeningPorts(
    cleanupPorts.filter(
      (expected) => !current.some((actual) => sameEndpoint(expected, actual)),
    ),
  );
}

function sameEndpoint(
  left: TaskListeningPort,
  right: TaskListeningPort,
): boolean {
  return (
    left.protocol === right.protocol &&
    left.address === right.address &&
    left.port === right.port
  );
}

export async function inspectPortListenersForCleanup(
  this: WorkbenchTaskService,
  record: TaskRecord,
  cleanupPorts: TaskListeningPort[],
): Promise<TaskListeningPort[]> {
  try {
    return await this.supervisor.inspectPortListeners(cleanupPorts);
  } catch (error) {
    await this.logger?.warn("Orphaned task port-listener recheck failed", {
      taskId: record.id,
      projectId: record.projectId,
      conversationId: record.conversationId,
      agentId: record.agentId,
      error,
      context: { ports: cleanupPorts.map(formatListeningPort) },
    });
    return cleanupPorts;
  }
}

export async function finalizeOrphanCleanup(
  this: WorkbenchTaskService,
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
  const releasedPorts = taskListeningPortsFromContext(context.releasedPorts);
  const updated = await this.updateTask(taskId, {
    status: "cancelled",
    readiness,
    finishedAt: new Date().toISOString(),
    exitCode: null,
    signal: finalSignal,
    error: undefined,
    lastOrphanCleanupReleasedPorts: releasedPorts,
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
  this: WorkbenchTaskService,
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

function taskListeningPortsFromContext(value: unknown): TaskListeningPort[] {
  return Array.isArray(value) ? (value as TaskListeningPort[]) : [];
}

export function runtimeLogContext(
  this: WorkbenchTaskService,
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
    listeningPorts: runtime?.listeningPorts?.map(formatListeningPort),
    ...extra,
  };
}

export function errorMessage(
  this: WorkbenchTaskService,
  error: unknown,
): string {
  return error instanceof Error ? error.message : String(error);
}
