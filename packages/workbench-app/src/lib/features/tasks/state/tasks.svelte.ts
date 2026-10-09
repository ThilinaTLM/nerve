import type { CancelTaskRequest } from "@nervekit/contracts/tasks";
import {
  cancelTask,
  deleteTask,
  pruneTasks,
  restartTask,
  startTask,
} from "$lib/api";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  loadTaskLogWindow,
  refreshTaskLogWindow,
} from "$lib/features/tasks/state/task-logs.svelte";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import {
  activateFallbackCenterTab,
  removeCenterTab,
} from "$lib/application/workspace/center-tabs.svelte";
import {
  setTaskEntryRun,
  taskEntryKey,
} from "$lib/features/tasks/state/task-tabs.svelte";
import { refreshWorkbenchTasks } from "./task-events";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
export async function selectTask(taskId: string) {
  taskState.selectedTaskId = taskId;
  await loadTaskLogWindow(taskId);
}

export async function cancelSelectedTask(
  taskId: string,
  request: CancelTaskRequest = {},
) {
  const wasOrphaned =
    taskState.tasks.find((task) => task.id === taskId)?.status === "orphaned";
  await cancelTask(taskId, request);
  await refreshWorkbenchTasks();
  if (taskState.selectedTaskId) {
    await loadTaskLogWindow(taskState.selectedTaskId);
  }
  notify.success(
    request.signal === "SIGKILL"
      ? "Launch force killed"
      : wasOrphaned
        ? "Orphaned launch cleanup completed"
        : "Launch cancelled",
  );
}

export async function restartSelectedTask(taskId: string) {
  const entryId = taskEntryKey(taskId);
  const restarted = await restartTask(taskId);
  setTaskEntryRun(entryId, restarted.id);
  taskState.selectedTaskId = restarted.id;
  await refreshWorkbenchTasks();
  await loadTaskLogWindow(restarted.id);
  notify.success("Launch restarted", {
    description: restarted.name ?? restarted.command ?? restarted.id,
  });
}

function forgetTask(taskId: string) {
  const entryId = taskEntryKey(taskId);
  const remaining = taskState.tasks
    .filter(
      (task) =>
        task.id !== taskId &&
        (task.definitionId ?? task.restartRootTaskId ?? task.id) === entryId,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (remaining[0]) setTaskEntryRun(entryId, remaining[0].id);
  else removeCenterTab({ kind: "task", id: entryId });
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
  await refreshWorkbenchTasks();
  notify.success("Launch removed");
}

export async function cleanupTaskRuns(taskIds: readonly string[]) {
  const ids = taskIds.filter((id, index) => taskIds.indexOf(id) === index);
  if (ids.length === 0) return;

  const results = await Promise.allSettled(ids.map((id) => deleteTask(id)));
  const removed = ids.filter(
    (_, index) => results[index]?.status === "fulfilled",
  );
  const failed = ids.length - removed.length;
  for (const id of removed) forgetTask(id);
  await refreshWorkbenchTasks();

  if (removed.length > 0) {
    notify.success(
      removed.length === 1
        ? "Removed 1 old launch run"
        : `Removed ${removed.length} old launch runs`,
    );
  }
  if (failed > 0) {
    notify.error(
      failed === 1
        ? "Could not remove 1 old launch run"
        : `Could not remove ${failed} old launch runs`,
    );
  }
}

export async function pruneFinishedTasks() {
  const { removed } = await pruneTasks();
  for (const id of removed) forgetTask(id);
  await refreshWorkbenchTasks();
  notify.success(
    removed.length === 1
      ? "Removed 1 finished launch"
      : `Removed ${removed.length} finished launches`,
  );
}

export async function runTaskCommand(input: {
  projectId: string;
  cwd: string;
  command: string;
  name?: string;
}) {
  const task = await startTask(input);
  await refreshWorkbenchTasks();
  await selectTask(task.id);
  notify.success("Command started", {
    description: input.name ?? input.command,
  });
  return task;
}

export async function refreshTaskLogs() {
  await refreshTaskLogWindow();
}
