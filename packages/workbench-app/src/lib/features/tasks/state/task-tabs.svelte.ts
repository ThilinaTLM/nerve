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

function addTaskTab(taskId: string) {
  addCenterTab({ kind: "task", id: taskId });
}

export async function openTaskTab(taskId: string) {
  addTaskTab(taskId);
  await selectCenterTaskTab(taskId);
}

export async function selectCenterConversationTab(conversationId: string) {
  await openConversation(conversationId);
}

export async function selectCenterTaskTab(taskId: string) {
  addTaskTab(taskId);
  taskState.selectedTaskId = taskId;
  setActiveCenterTab({ kind: "task", id: taskId });
  await loadTaskLogWindow(taskId);
}

export async function closeTaskTab(taskId: string) {
  const tab = { kind: "task" as const, id: taskId };
  const closingActive =
    workspaceState.activeCenterTab?.kind === "task" &&
    workspaceState.activeCenterTab.id === taskId;
  const fallback = nextCenterTabAfterClose(tab);
  removeCenterTab(tab);

  if (taskState.selectedTaskId === taskId) {
    taskState.selectedTaskId = undefined;
    taskState.taskLogs = undefined;
  }

  if (closingActive) await selectCenterTab(fallback);
}
