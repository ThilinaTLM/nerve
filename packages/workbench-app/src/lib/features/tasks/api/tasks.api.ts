import type {
  StartTaskRequest,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/contracts";
import { apiGet, apiPathSegment } from "@nervekit/ui-kit/core/api/client";
import { protocolRequest } from "@nervekit/protocol";

export async function getTaskLogs(
  taskId: string,
  query: TaskLogQuery = {},
): Promise<TaskLogQueryResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return apiGet<TaskLogQueryResponse>(
    `/api/tasks/${apiPathSegment(taskId)}/logs?${params.toString()}`,
  );
}

export async function startTask(body: StartTaskRequest): Promise<TaskRecord> {
  return (await protocolRequest("task.start", body)).result.task;
}

export async function cancelTask(taskId: string): Promise<TaskRecord> {
  return (await protocolRequest("task.cancel", { taskId })).result.task;
}

export async function restartTask(taskId: string): Promise<TaskRecord> {
  return (await protocolRequest("task.restart", { taskId })).result.task;
}

export async function deleteTask(taskId: string): Promise<void> {
  await protocolRequest("task.delete", { taskId });
}

export async function pruneTasks(): Promise<{ removed: string[] }> {
  return (await protocolRequest("task.prune", {})).result;
}
