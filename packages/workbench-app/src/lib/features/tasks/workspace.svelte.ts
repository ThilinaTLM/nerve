import { loadTaskLogWindow } from "./state/task-logs.svelte";
import { resolveSelectedTaskId } from "./state/task-reducers";
import { taskState } from "./state/task-state.svelte";

export const taskWorkspaceReadModel = {
  get tasks() {
    return taskState.tasks;
  },
  get openTaskTabIds() {
    return taskState.openTaskTabIds;
  },
  get selectedTaskId() {
    return taskState.selectedTaskId;
  },
  get selectedRunByEntry() {
    return taskState.selectedRunByEntry;
  },
  get taskLogs() {
    return taskState.taskLogs;
  },
};

export const taskWorkspaceCommands = {
  setTasks(tasks: typeof taskState.tasks): void {
    taskState.tasks = tasks;
  },
  setOpenTaskTabIds(ids: string[]): void {
    taskState.openTaskTabIds = ids;
  },
  setSelectedTaskId(id: string | undefined): void {
    taskState.selectedTaskId = id;
  },
  clearTaskLogs(): void {
    taskState.taskLogs = undefined;
  },
  resolveSelectedTaskId,
  loadTaskLogWindow,
};
