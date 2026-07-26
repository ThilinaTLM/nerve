import { getTaskLogs } from "$lib/features/tasks/api/tasks.api";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  appendTaskLogPage,
  MAX_TASK_LOG_WINDOW_EVENTS,
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
  taskState.logHistorySearch = undefined;
  const response = await getTaskLogs(taskId, {
    mode: "recent",
    limit: LOG_PAGE_SIZE,
  });
  if (request !== initialRequest || taskState.selectedTaskId !== taskId) return;
  taskState.taskLogs = response;
}

/**
 * Runs a server-side search across the whole retained log. The result replaces the live
 * window until the caller returns to live output, because filtered cursors cannot be
 * merged safely with unfiltered incremental pages.
 */
export async function searchTaskLogHistory(
  taskId: string,
  filter: { text: string; useRegex: boolean },
): Promise<void> {
  const text = filter.text.trim();
  if (!text) return;
  taskState.logHistorySearching = true;
  try {
    const response = await getTaskLogs(taskId, {
      mode: "recent",
      limit: LOG_PAGE_SIZE,
      ...(filter.useRegex ? { regex: text } : { contains: text }),
    });
    if (taskState.selectedTaskId !== taskId) return;
    taskState.taskLogs = response;
    taskState.logHistorySearch = {
      taskId,
      text,
      useRegex: filter.useRegex,
      truncated: response.hasMoreBefore,
    };
  } catch (error) {
    notify.error(
      `Could not search task output: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    taskState.logHistorySearching = false;
  }
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
    beforeSeq === undefined ||
    taskState.logHistorySearch?.taskId === taskId ||
    current.events.length >= MAX_TASK_LOG_WINDOW_EVENTS
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
