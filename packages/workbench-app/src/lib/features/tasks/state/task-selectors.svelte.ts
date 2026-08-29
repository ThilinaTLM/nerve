import { isPathInDirectory } from "$lib/domain/filesystem/project-path";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { taskEntryId } from "./task-tabs.svelte";
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
      .filter((task) => taskEntryId(task) === active.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return (
      candidates.find(
        (task) => task.id === taskState.selectedRunByEntry[active.id],
      ) ?? candidates[0]
    );
  },
  get activeCenterTaskRuns() {
    const active = workspaceState.activeCenterTab;
    if (active?.kind !== "task") return [];
    return taskState.tasks
      .filter((task) => taskEntryId(task) === active.id)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  },
  get taskLogs() {
    return taskState.taskLogs;
  },
};
