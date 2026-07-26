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
    const candidates = taskState.tasks
      .filter(
        (task) =>
          (task.definitionId ?? task.restartRootTaskId ?? task.id) ===
          active.id,
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return (
      candidates.find(
        (task) => task.id === taskState.selectedRunByEntry[active.id],
      ) ?? candidates[0]
    );
  },
  get taskLogs() {
    return taskState.taskLogs;
  },
};
