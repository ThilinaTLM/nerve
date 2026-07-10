import type {
  TaskLogQueryResponse,
  TaskOrigin,
  TaskRecord,
} from "@nervekit/contracts";
import type {
  SupervisedTask,
  SupervisedTaskLogQueryResponse,
} from "./task-supervisor.js";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "orphaned",
]);

export function taskRecordFromSupervisedTask(task: SupervisedTask): TaskRecord {
  const origin = task.origin ?? inferredOrigin(task);
  return {
    id: task.id,
    name: task.name,
    conversationId: task.conversationId,
    agentId: task.agentId,
    cwd: task.cwd ?? "/workspace",
    command: task.command,
    status: task.status,
    readiness: { outcome: "none" },
    stdoutPath: `task://${task.id}/stdout`,
    stderrPath: `task://${task.id}/stderr`,
    combinedPath: `task://${task.id}/logs`,
    logsPath: `task://${task.id}/logs`,
    startedAt: task.startedAt,
    updatedAt: task.updatedAt,
    finishedAt: TERMINAL_STATUSES.has(task.status)
      ? task.completedAt
      : undefined,
    exitCode: task.exitCode ?? null,
    signal: task.signal ?? null,
    timeoutMs: task.maxRuntimeMs,
    restartedFromTaskId: task.restartedFromTaskId,
    restartRootTaskId: task.restartRootTaskId,
    restartGeneration: task.restartGeneration,
    origin,
    visibility: "background",
  };
}

export function taskLogQueryResponseFromSupervised(
  response: SupervisedTaskLogQueryResponse,
): TaskLogQueryResponse {
  return {
    task: taskRecordFromSupervisedTask(response.task),
    events: response.events,
    nextCursor: response.nextCursor,
    mode: response.mode,
    previewPath: `task://${response.task.id}/logs`,
    truncated: response.truncated,
  };
}

function inferredOrigin(task: SupervisedTask): TaskOrigin {
  if (task.toolCallId?.startsWith("tool_")) {
    return {
      kind: "agent_tool",
      toolCallId: task.toolCallId,
      runId: task.runId?.startsWith("run_") ? task.runId : undefined,
    };
  }
  return { kind: "api" };
}
