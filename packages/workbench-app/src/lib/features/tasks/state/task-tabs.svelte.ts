import { loadTaskLogWindow } from "$lib/features/tasks/state/task-logs.svelte";
import { openConversation } from "$lib/features/conversations/state/conversation-flow.svelte";
import { taskState } from "$lib/features/tasks/state/task-state.svelte";
import {
  addCenterTab,
  nextCenterTabAfterClose,
  removeCenterTab,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import type { TaskRecord } from "@nervekit/contracts";

export function taskEntryId(task: TaskRecord): string {
  return task.definitionId ?? task.restartRootTaskId ?? task.id;
}

export function taskEntryKey(taskId: string): string {
  const task = taskState.tasks.find((candidate) => candidate.id === taskId);
  return task ? taskEntryId(task) : taskId;
}

export function runForTaskEntry(entryId: string) {
  const selectedId = taskState.selectedRunByEntry[entryId];
  const candidates = taskState.tasks
    .filter((task) => taskEntryId(task) === entryId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return candidates.find((task) => task.id === selectedId) ?? candidates[0];
}

export function setTaskEntryRun(entryId: string, taskId: string): void {
  taskState.selectedRunByEntry[entryId] = taskId;
}

export async function selectTaskEntryRun(
  entryId: string,
  taskId: string,
): Promise<void> {
  const task = taskState.tasks.find(
    (candidate) =>
      candidate.id === taskId && taskEntryId(candidate) === entryId,
  );
  if (!task) return;
  setTaskEntryRun(entryId, taskId);
  taskState.selectedTaskId = taskId;
  await loadTaskLogWindow(taskId);
}

export async function openTaskTab(taskId: string) {
  const owningTask = taskState.tasks.find(
    (candidate) => candidate.id === taskId,
  );
  if (
    owningTask?.projectId &&
    owningTask.projectId !== workspaceState.selectedProjectId
  ) {
    const { selectProject } =
      await import("$lib/features/workspace/state/workspace-actions.svelte");
    await selectProject(owningTask.projectId);
  }
  const entryId = taskEntryKey(taskId);
  setTaskEntryRun(entryId, taskId);
  addCenterTab({ kind: "task", id: entryId });
  await selectCenterTaskTab(entryId);
}

export async function selectCenterConversationTab(conversationId: string) {
  await openConversation(conversationId);
}

export async function selectCenterTaskTab(entryId: string) {
  const task = runForTaskEntry(entryId);
  addCenterTab({ kind: "task", id: entryId });
  setActiveCenterTab({ kind: "task", id: entryId });
  if (task) await selectTaskEntryRun(entryId, task.id);
  else taskState.selectedTaskId = undefined;
}

export async function closeTaskTab(entryId: string) {
  const tab = { kind: "task" as const, id: entryId };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "task" &&
    workspaceState.activeCenterTab.id === entryId;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);
  delete taskState.selectedRunByEntry[entryId];

  if (
    taskState.selectedTaskId &&
    taskEntryKey(taskState.selectedTaskId) === entryId
  ) {
    taskState.selectedTaskId = undefined;
    taskState.taskLogs = undefined;
  }

  if (closingActive) await selectCenterTab(fallback);
}
