import type {
  StartTaskRequest,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts";
import { apiGet, apiPathSegment } from "@nervekit/workbench-ui/core/api/client";
import { protocolRequest } from "../../../core/protocol/http-client";

export async function getTaskLogs(
  taskId: string,
  mode = "recent",
): Promise<TaskLogQueryResponse> {
  const params = new URLSearchParams({ mode, limit: "120" });
  return apiGet<TaskLogQueryResponse>(
    `/api/tasks/${apiPathSegment(taskId)}/logs?${params.toString()}`,
  );
}

export async function startTask(body: StartTaskRequest): Promise<TaskRecord> {
  return (await protocolRequest<{ task: TaskRecord }>("task.start", body))
    .result.task;
}

export async function cancelTask(taskId: string): Promise<TaskRecord> {
  return (
    await protocolRequest<{ task: TaskRecord }>("task.cancel", { taskId })
  ).result.task;
}

export async function restartTask(taskId: string): Promise<TaskRecord> {
  return (
    await protocolRequest<{ task: TaskRecord }>("task.restart", { taskId })
  ).result.task;
}

export async function deleteTask(taskId: string): Promise<void> {
  await protocolRequest<{ removed: true }>("task.delete", { taskId });
}

export async function pruneTasks(): Promise<{ removed: string[] }> {
  return (await protocolRequest<{ removed: string[] }>("task.prune", {}))
    .result;
}
