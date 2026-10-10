import type {
  CancelTaskRequest,
  StartTaskRequest,
  TaskLogQuery,
  TaskLogQueryResponse,
  TaskPortConflictListener,
  TaskRecord,
} from "@nervekit/contracts/tasks";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";

export async function getTaskLogs(
  taskId: string,
  query: TaskLogQuery = {},
): Promise<TaskLogQueryResponse> {
  return await requestWorkbench("launch.logs", { taskId, ...query });
}

export async function startTask(body: StartTaskRequest): Promise<TaskRecord> {
  return (await requestWorkbench("launch.start", body)).task;
}

export async function launchTaskDefinition(
  definitionId: string,
  terminateListeners?: TaskPortConflictListener[],
) {
  return await requestWorkbench("launch.launchDefinition", {
    definitionId,
    terminateListeners,
  });
}

export async function cancelTask(
  taskId: string,
  request: CancelTaskRequest = {},
): Promise<TaskRecord> {
  return (await requestWorkbench("launch.cancel", { taskId, ...request })).task;
}

export async function restartTask(taskId: string): Promise<TaskRecord> {
  return (
    await requestWorkbench("launch.restart", {
      taskId,
    })
  ).task;
}

export async function deleteTask(taskId: string): Promise<void> {
  await requestWorkbench("launch.delete", { taskId });
}

export async function pruneTasks(): Promise<{ removed: string[] }> {
  return await requestWorkbench("launch.prune", {});
}
