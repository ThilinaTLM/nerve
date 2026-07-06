import {
  cancelTask,
  deleteTask,
  getTaskLogs,
  pruneTasks,
  restartTask,
  startTask,
} from "$lib/api";
import { notify } from "$lib/features/notifications/notify.svelte";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import {
  activateFallbackCenterTab,
  removeCenterTab,
  replaceCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { loadWorkspaceState } from "$lib/features/workspace/state/workspace-actions.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
export async function selectTask(taskId: string) {
  taskState.selectedTaskId = taskId;
  taskState.taskLogs = await getTaskLogs(taskId);
}

export async function cancelSelectedTask(taskId: string) {
  const wasOrphaned =
    taskState.tasks.find((task) => task.id === taskId)?.status === "orphaned";
  await cancelTask(taskId);
  await loadWorkspaceState();
  if (taskState.selectedTaskId) {
    taskState.taskLogs = await getTaskLogs(taskState.selectedTaskId);
  }
  notify.success(
    wasOrphaned ? "Orphaned task cleanup completed" : "Task cancelled",
  );
}

export async function restartSelectedTask(taskId: string) {
  const restarted = await restartTask(taskId);
  if (restarted.id !== taskId) {
    replaceCenterTab(
      { kind: "task", id: taskId },
      { kind: "task", id: restarted.id },
    );
  }
  taskState.selectedTaskId = restarted.id;
  await loadWorkspaceState();
  taskState.taskLogs = await getTaskLogs(restarted.id);
  notify.success("Task restarted", {
    description: restarted.name ?? restarted.command ?? restarted.id,
  });
}

function forgetTask(taskId: string) {
  removeCenterTab({ kind: "task", id: taskId });
  if (
    workspaceState.activeCenterTab?.kind === "task" &&
    workspaceState.activeCenterTab.id === taskId
  ) {
    activateFallbackCenterTab();
  }
  if (taskState.selectedTaskId === taskId) {
    taskState.selectedTaskId = undefined;
    taskState.taskLogs = undefined;
  }
}

export async function removeTask(taskId: string) {
  await deleteTask(taskId);
  forgetTask(taskId);
  await loadWorkspaceState();
  notify.success("Task removed");
}

export async function pruneFinishedTasks() {
  const { removed } = await pruneTasks();
  for (const id of removed) forgetTask(id);
  await loadWorkspaceState();
  notify.success(
    removed.length === 1
      ? "Removed 1 finished task"
      : `Removed ${removed.length} finished tasks`,
  );
}

export async function runTaskCommand(input: {
  projectId: string;
  cwd: string;
  command: string;
  name?: string;
}) {
  const task = await startTask(input);
  await loadWorkspaceState();
  await selectTask(task.id);
  notify.success("Command started", {
    description: input.name ?? input.command,
  });
  return task;
}

export async function refreshTaskLogs() {
  if (!taskState.selectedTaskId) return;
  taskState.taskLogs = await getTaskLogs(taskState.selectedTaskId);
}
