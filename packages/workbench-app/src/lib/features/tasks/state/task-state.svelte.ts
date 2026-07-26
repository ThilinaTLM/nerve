import type { TaskLogQueryResponse, TaskRecord } from "$lib/api";

export type TaskLogHistorySearch = {
  taskId: string;
  text: string;
  useRegex: boolean;
  /** True when more matches exist before the returned page. */
  truncated: boolean;
};

export const taskState = $state({
  tasks: [] as TaskRecord[],
  selectedTaskId: undefined as string | undefined,
  taskLogs: undefined as TaskLogQueryResponse | undefined,
  /** Set while the log view shows a server-side history search instead of the live window. */
  logHistorySearch: undefined as TaskLogHistorySearch | undefined,
  logHistorySearching: false,
  selectedRunByEntry: {} as Record<string, string>,
  openTaskTabIds: [] as string[],
});
