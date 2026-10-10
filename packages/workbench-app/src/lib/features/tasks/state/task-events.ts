import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { refreshTaskLogWindow } from "./task-logs.svelte";
import {
  onEvent,
  onWorkbenchReconnect,
} from "$lib/application/events/workbench-event-bus";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { taskState } from "./task-state.svelte";

export function registerTaskEventHandlers(): () => void {
  const disposers = [
    onWorkbenchReconnect(refreshWorkbenchTasks),
    onEvent("launch.output", handleTaskLogEvent),
    onEvent("launch.removed", handleTaskRemovedEvent),
    onEvent("launch.created", handleTaskRecordEvent),
    onEvent("launch.started", handleTaskRecordEvent),
    onEvent("launch.runtime_updated", handleTaskRecordEvent),
    onEvent("launch.ready", handleTaskRecordEvent),
    onEvent("launch.stop_requested", handleTaskRecordEvent),
    onEvent("launch.readiness_failed", handleTaskRecordEvent),
    onEvent("launch.timed_out", handleTaskRecordEvent),
    onEvent("launch.completed", handleTaskRecordEvent),
    onEvent("launch.failed", handleTaskRecordEvent),
    onEvent("launch.cancelled", handleTaskRecordEvent),
    onEvent("launch.updated", handleTaskRecordEvent),
  ];
  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}

function handleTaskRecordEvent(event: {
  data?: Record<string, unknown>;
}): void {
  if (!event.data?.task) return;
  void refreshWorkbenchTasks().catch(() => undefined);
}

function handleTaskRemovedEvent(event: {
  data?: Record<string, unknown>;
}): void {
  const taskId = String(event.data?.taskId ?? "");
  if (!taskId) return;
  taskState.tasks = taskState.tasks.filter((task) => task.id !== taskId);
  if (taskState.selectedTaskId === taskId) {
    taskState.selectedTaskId = undefined;
    taskState.taskLogs = undefined;
  }
}

function handleTaskLogEvent(event: { data?: Record<string, unknown> }): void {
  handleTaskRecordEvent(event);
  const taskId = String(event.data?.taskId ?? "");
  const task = taskState.tasks.find((candidate) => candidate.id === taskId);
  const entryId = task?.definitionId ?? task?.restartRootTaskId ?? taskId;
  const viewingTask =
    workspaceState.activeCenterTab?.kind === "task" &&
    workspaceState.activeCenterTab.id === entryId;
  if (taskId && taskId === taskState.selectedTaskId && viewingTask) {
    void refreshTaskLogWindow(taskId).catch(() => undefined);
  }
}

export async function refreshWorkbenchTasks(): Promise<void> {
  taskState.tasks = (await requestWorkbench("launch.list", {})).tasks;
  if (
    taskState.selectedTaskId &&
    !taskState.tasks.some((task) => task.id === taskState.selectedTaskId)
  ) {
    taskState.selectedTaskId = undefined;
    taskState.taskLogs = undefined;
  }
  if (taskState.selectedTaskId)
    await refreshTaskLogWindow(taskState.selectedTaskId);
}
