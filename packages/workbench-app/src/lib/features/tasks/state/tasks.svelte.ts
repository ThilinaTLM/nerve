import type { CancelTaskRequest } from "@nervekit/contracts";
import {
  cancelTask,
  deleteTask,
  pruneTasks,
  restartTask,
  startTask,
} from "$lib/api";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  loadTaskLogWindow,
  refreshTaskLogWindow,
} from "$lib/features/tasks/state/task-logs.svelte";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import { closeCenterTab } from "$lib/features/workspace/state/center-tab-actions.svelte";
import {
  setTaskEntryRun,
  taskEntryKey,
} from "$lib/features/tasks/state/task-tabs.svelte";
import { loadWorkspaceState } from "$lib/features/workspace/state/workspace-actions.svelte";
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
  await loadWorkspaceState();
  if (taskState.selectedTaskId) {
    await loadTaskLogWindow(taskState.selectedTaskId);
  }
  notify.success(
    request.signal === "SIGKILL"
      ? "Task force killed"
      : wasOrphaned
        ? "Orphaned task cleanup completed"
        : "Task cancelled",
  );
}

export async function restartSelectedTask(taskId: string) {
  const entryId = taskEntryKey(taskId);
  const restarted = await restartTask(taskId);
  setTaskEntryRun(entryId, restarted.id);
  taskState.selectedTaskId = restarted.id;
  await loadWorkspaceState();
  await loadTaskLogWindow(restarted.id);
  notify.success("Task restarted", {
    description: restarted.name ?? restarted.command ?? restarted.id,
  });
}

async function forgetTask(taskId: string) {
  const entryId = taskEntryKey(taskId);
  const remaining = taskState.tasks
    .filter(
      (task) =>
        task.id !== taskId &&
        (task.definitionId ?? task.restartRootTaskId ?? task.id) === entryId,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (remaining[0]) setTaskEntryRun(entryId, remaining[0].id);
  else await closeCenterTab({ kind: "task", id: entryId });
  if (taskState.selectedTaskId === taskId) {
    taskState.selectedTaskId = undefined;
    taskState.taskLogs = undefined;
  }
}

export async function removeTask(taskId: string) {
  await deleteTask(taskId);
  await forgetTask(taskId);
  await loadWorkspaceState();
  notify.success("Task removed");
}

export async function cleanupTaskRuns(taskIds: readonly string[]) {
  const ids = taskIds.filter((id, index) => taskIds.indexOf(id) === index);
  if (ids.length === 0) return;

  const results = await Promise.allSettled(ids.map((id) => deleteTask(id)));
  const removed = ids.filter(
    (_, index) => results[index]?.status === "fulfilled",
  );
  const failed = ids.length - removed.length;
  for (const id of removed) await forgetTask(id);
  await loadWorkspaceState();

  if (removed.length > 0) {
    notify.success(
      removed.length === 1
        ? "Removed 1 old task run"
        : `Removed ${removed.length} old task runs`,
    );
  }
  if (failed > 0) {
    notify.error(
      failed === 1
        ? "Could not remove 1 old task run"
        : `Could not remove ${failed} old task runs`,
    );
  }
}

export async function pruneFinishedTasks() {
  const { removed } = await pruneTasks();
  for (const id of removed) await forgetTask(id);
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
  await refreshTaskLogWindow();
}
