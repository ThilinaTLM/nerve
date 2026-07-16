import { getTaskLogs } from "$lib/features/tasks/api/tasks.api";
import {
  appendTaskLogPage,
  prependTaskLogPage,
} from "@nervekit/workbench-ui/tasks";
import { SvelteMap } from "svelte/reactivity";
import { taskState } from "./task-state.svelte";

const LOG_PAGE_SIZE = 500;

let initialRequest = 0;
const earlierRequests = new SvelteMap<string, Promise<void>>();
let refreshRequest: Promise<void> | undefined;
let refreshRequested = false;

export async function loadTaskLogWindow(taskId: string): Promise<void> {
  const request = ++initialRequest;
  const response = await getTaskLogs(taskId, {
    mode: "recent",
    limit: LOG_PAGE_SIZE,
  });
  if (request !== initialRequest || taskState.selectedTaskId !== taskId) return;
  taskState.taskLogs = response;
}

export function loadEarlierTaskLogs(taskId: string): Promise<void> {
  const existing = earlierRequests.get(taskId);
  if (existing) return existing;
  const current = taskState.taskLogs;
  const beforeSeq = current?.events[0]?.seq;
  if (
    taskState.selectedTaskId !== taskId ||
    current?.task.id !== taskId ||
    !current.hasMoreBefore ||
    beforeSeq === undefined
  ) {
    return Promise.resolve();
  }

  const request = getTaskLogs(taskId, {
    mode: "recent",
    beforeSeq,
    limit: LOG_PAGE_SIZE,
  })
    .then((older) => {
      const latest = taskState.taskLogs;
      if (taskState.selectedTaskId !== taskId || latest?.task.id !== taskId)
        return;
      taskState.taskLogs = prependTaskLogPage(latest, older);
    })
    .finally(() => earlierRequests.delete(taskId));
  earlierRequests.set(taskId, request);
  return request;
}

export function refreshTaskLogWindow(
  taskId = taskState.selectedTaskId,
): Promise<void> {
  if (!taskId) return Promise.resolve();
  refreshRequested = true;
  if (refreshRequest) return refreshRequest;

  refreshRequest = (async () => {
    do {
      refreshRequested = false;
      let current = taskState.taskLogs;
      if (taskState.selectedTaskId !== taskId || current?.task.id !== taskId)
        return;

      let newer = await getTaskLogs(taskId, {
        mode: "since_cursor",
        sinceSeq: current.nextCursor,
        limit: LOG_PAGE_SIZE,
      });
      while (true) {
        current = taskState.taskLogs;
        if (taskState.selectedTaskId !== taskId || current?.task.id !== taskId)
          return;
        taskState.taskLogs = appendTaskLogPage(current, newer);
        if (!newer.hasMoreAfter) break;
        newer = await getTaskLogs(taskId, {
          mode: "since_cursor",
          sinceSeq: newer.nextCursor,
          limit: LOG_PAGE_SIZE,
        });
      }
    } while (refreshRequested);
  })().finally(() => {
    refreshRequest = undefined;
  });

  return refreshRequest;
}
