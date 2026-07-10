import type {
  StartTaskRequest,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts";
import { protocolRequest } from "./manager-protocol-client";

export async function listSandboxTasks(
  sandboxId: string,
): Promise<TaskRecord[]> {
  return (
    await protocolRequest<{ tasks: TaskRecord[] }>("task.list", {
      sandboxId,
    })
  ).result.tasks;
}

export async function startSandboxTask(
  sandboxId: string,
  request: Omit<StartTaskRequest, "cwd"> & { cwd?: string },
): Promise<TaskRecord> {
  return (
    await protocolRequest<{ task: TaskRecord }>(
      "task.start",
      { sandboxId, ...request },
      { idempotencyKey: `sandbox-task-start-${sandboxId}-${Date.now()}` },
    )
  ).result.task;
}

export async function getSandboxTask(
  sandboxId: string,
  taskId: string,
): Promise<TaskRecord> {
  return (
    await protocolRequest<{ task: TaskRecord }>("task.get", {
      sandboxId,
      taskId,
    })
  ).result.task;
}

export async function cancelSandboxTask(
  sandboxId: string,
  taskId: string,
): Promise<TaskRecord> {
  return (
    await protocolRequest<{ task: TaskRecord }>(
      "task.cancel",
      { sandboxId, taskId },
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
    await protocolRequest<{ task: TaskRecord }>(
      "task.restart",
      { sandboxId, taskId },
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
  await protocolRequest<{ removed: true }>(
    "task.delete",
    { sandboxId, taskId },
    {
      idempotencyKey: `sandbox-task-delete-${sandboxId}-${taskId}-${Date.now()}`,
    },
  );
}

export async function pruneSandboxTasks(
  sandboxId: string,
): Promise<{ removed: string[] }> {
  return (
    await protocolRequest<{ removed: string[] }>(
      "task.prune",
      { sandboxId },
      { idempotencyKey: `sandbox-task-prune-${sandboxId}-${Date.now()}` },
    )
  ).result;
}

export async function getSandboxTaskLogs(
  sandboxId: string,
  taskId: string,
  mode = "recent",
): Promise<TaskLogQueryResponse> {
  return (
    await protocolRequest<TaskLogQueryResponse>("task.logs", {
      sandboxId,
      taskId,
      mode,
      limit: 120,
    })
  ).result;
}
