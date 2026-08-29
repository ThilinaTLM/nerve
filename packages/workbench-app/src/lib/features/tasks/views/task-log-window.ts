import type { TaskLogEvent, TaskLogQueryResponse } from "@nervekit/contracts";

/**
 * Upper bound for the in-memory log window. Older events stay reachable through
 * backward paging, so trimming keeps long-running tasks from growing unbounded.
 */
export const MAX_TASK_LOG_WINDOW_EVENTS = 5000;

export function prependTaskLogPage(
  current: TaskLogQueryResponse,
  older: TaskLogQueryResponse,
): TaskLogQueryResponse {
  return {
    ...current,
    task: older.task,
    events: mergeEvents(older.events, current.events),
    hasMoreBefore: older.hasMoreBefore,
    truncated: Boolean(current.truncated || older.truncated),
    previewPath: current.previewPath ?? older.previewPath,
  };
}

export function appendTaskLogPage(
  current: TaskLogQueryResponse,
  newer: TaskLogQueryResponse,
): TaskLogQueryResponse {
  const merged = mergeEvents(current.events, newer.events);
  const overflow = Math.max(0, merged.length - MAX_TASK_LOG_WINDOW_EVENTS);
  return {
    ...current,
    task: newer.task,
    events: overflow > 0 ? merged.slice(overflow) : merged,
    nextCursor: newer.nextCursor,
    hasMoreAfter: newer.hasMoreAfter,
    hasMoreBefore: overflow > 0 ? true : current.hasMoreBefore,
    truncated: Boolean(current.truncated || newer.truncated),
    previewPath: newer.previewPath ?? current.previewPath,
  };
}

function mergeEvents(
  first: readonly TaskLogEvent[],
  second: readonly TaskLogEvent[],
): TaskLogEvent[] {
  const bySequence = new Map<number, TaskLogEvent>();
  for (const event of first) bySequence.set(event.seq, event);
  for (const event of second) bySequence.set(event.seq, event);
  return [...bySequence.values()].sort((a, b) => a.seq - b.seq);
}
