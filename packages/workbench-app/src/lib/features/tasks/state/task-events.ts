import type { TaskRecord } from "@nervekit/contracts";
import { refreshTaskLogWindow } from "./task-logs.svelte";
import { onEvent } from "$lib/core/events/event-bus";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { applyVisibleTaskRecord } from "./task-reducers";
import { taskState } from "./task-state.svelte";

export function registerTaskEventHandlers(): () => void {
  const disposers = [
    onEvent("task.output", handleTaskLogEvent),
    onEvent("task.removed", handleTaskRemovedEvent),
    onEvent("task.created", handleTaskRecordEvent),
    onEvent("task.started", handleTaskRecordEvent),
    onEvent("task.runtime_updated", handleTaskRecordEvent),
    onEvent("task.ready", handleTaskRecordEvent),
    onEvent("task.timed_out", handleTaskRecordEvent),
    onEvent("task.promoted", handleTaskRecordEvent),
    onEvent("task.completed", handleTaskRecordEvent),
    onEvent("task.failed", handleTaskRecordEvent),
    onEvent("task.cancelled", handleTaskRecordEvent),
    onEvent("task.orphaned", handleTaskRecordEvent),
    onEvent("task.orphan_cleanup_succeeded", handleTaskRecordEvent),
  ];
  return () => {
    for (const dispose of disposers.splice(0)) dispose();
  };
}

function handleTaskRecordEvent(event: {
  data?: Record<string, unknown>;
}): void {
  const task = event.data?.task as TaskRecord | undefined;
  if (!task?.id) return;
  taskState.tasks = applyVisibleTaskRecord(taskState.tasks, task);
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
  const viewingTask =
    workspaceState.activeCenterTab?.kind === "task" &&
    workspaceState.activeCenterTab.id === taskId;
  if (taskId && taskId === taskState.selectedTaskId && viewingTask) {
    void refreshTaskLogWindow(taskId).catch(() => undefined);
  }
}
