import type {
  StartTaskRequest,
  TaskLogQueryResponse,
  TaskRecord,
} from "@nervekit/shared";
import {
  apiDelete,
  apiGet,
  apiPathSegment,
  apiPost,
} from "../../../core/api/client";

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
  return (await apiPost<{ task: TaskRecord }>("/api/tasks", body)).task;
}

export async function cancelTask(taskId: string): Promise<TaskRecord> {
  return (
    await apiPost<{ task: TaskRecord }>(
      `/api/tasks/${apiPathSegment(taskId)}/cancel`,
      {},
    )
  ).task;
}

export async function restartTask(taskId: string): Promise<TaskRecord> {
  return (
    await apiPost<{ task: TaskRecord }>(
      `/api/tasks/${apiPathSegment(taskId)}/restart`,
      {},
    )
  ).task;
}

export async function deleteTask(taskId: string): Promise<void> {
  await apiDelete<{ removed: boolean }>(`/api/tasks/${apiPathSegment(taskId)}`);
}

export async function pruneTasks(): Promise<{ removed: string[] }> {
  return apiPost<{ removed: string[] }>("/api/tasks/prune", {});
}
