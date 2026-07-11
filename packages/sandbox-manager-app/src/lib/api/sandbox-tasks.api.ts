import type {
  StartTaskRequest,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts";
import { sandboxProtocolRequest } from "./manager-protocol-client";

export async function listSandboxTasks(
  sandboxId: string,
): Promise<TaskRecord[]> {
  return (await sandboxProtocolRequest(sandboxId, "task.list", {})).result
    .tasks;
}

export async function startSandboxTask(
  sandboxId: string,
  request: Omit<StartTaskRequest, "cwd"> & { cwd?: string },
): Promise<TaskRecord> {
  return (
    await sandboxProtocolRequest(
      sandboxId,
      "task.start",
      { ...request, cwd: request.cwd ?? "/workspace" },
      { idempotencyKey: `sandbox-task-start-${sandboxId}-${Date.now()}` },
    )
  ).result.task;
}

export async function getSandboxTask(
  sandboxId: string,
  taskId: string,
): Promise<TaskRecord> {
  return (await sandboxProtocolRequest(sandboxId, "task.get", { taskId }))
    .result.task;
}

export async function cancelSandboxTask(
  sandboxId: string,
  taskId: string,
): Promise<TaskRecord> {
  return (
    await sandboxProtocolRequest(
      sandboxId,
      "task.cancel",
      { taskId },
      {
        idempotencyKey: `sandbox-task-cancel-${sandboxId}-${taskId}-${Date.now()}`,
      },
    )
  ).result.task;
}

export async function restartSandboxTask(
  sandboxId: string,
  taskId: string,
): Promise<TaskRecord> {
  return (
    await sandboxProtocolRequest(
      sandboxId,
      "task.restart",
      { taskId },
      {
        idempotencyKey: `sandbox-task-restart-${sandboxId}-${taskId}-${Date.now()}`,
      },
    )
  ).result.task;
}

export async function deleteSandboxTask(
  sandboxId: string,
  taskId: string,
): Promise<void> {
  await sandboxProtocolRequest(
    sandboxId,
    "task.delete",
    { taskId },
    {
      idempotencyKey: `sandbox-task-delete-${sandboxId}-${taskId}-${Date.now()}`,
    },
  );
}

export async function pruneSandboxTasks(
  sandboxId: string,
): Promise<{ removed: string[] }> {
  return (
    await sandboxProtocolRequest(
      sandboxId,
      "task.prune",
      {},
      { idempotencyKey: `sandbox-task-prune-${sandboxId}-${Date.now()}` },
    )
  ).result;
}

export async function getSandboxTaskLogs(
  sandboxId: string,
  taskId: string,
  mode: TaskLogQuery["mode"] = "recent",
): Promise<TaskLogQueryResponse> {
  return (
    await sandboxProtocolRequest(sandboxId, "task.logs", {
      taskId,
      mode,
      limit: 120,
    })
  ).result;
}
