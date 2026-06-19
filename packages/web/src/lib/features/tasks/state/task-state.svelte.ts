import type { TaskLogQueryResponse, TaskRecord } from "$lib/api";

export const taskState = $state({
  tasks: [] as TaskRecord[],
  selectedTaskId: undefined as string | undefined,
  taskLogs: undefined as TaskLogQueryResponse | undefined,
  openTaskTabIds: [] as string[],
});
