import { isPathInDirectory } from "$lib/core/utils/path";
import { workspaceSelectors } from "$lib/features/workspace/state/workspace-selectors.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { taskState } from "./task-state.svelte";

export const taskSelectors = {
  get tasks() {
    return taskState.tasks;
  },
  get scopedTasks() {
    const projectDir = workspaceSelectors.activeProject?.dir;
    if (!projectDir) return [];
    return taskState.tasks.filter((task) =>
      isPathInDirectory(task.cwd, projectDir),
    );
  },
  get selectedTask() {
    return taskState.tasks.find((task) => task.id === taskState.selectedTaskId);
  },
  get activeCenterTask() {
    const active = workspaceState.activeCenterTab;
    if (active?.kind !== "task") return undefined;
    return taskState.tasks.find((task) => task.id === active.id);
  },
  get taskLogs() {
    return taskState.taskLogs;
  },
};
