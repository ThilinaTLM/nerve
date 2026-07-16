import type { TaskLogEvent, TaskLogQueryResponse } from "@nervekit/contracts";

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
  return {
    ...current,
    task: newer.task,
    events: mergeEvents(current.events, newer.events),
    nextCursor: newer.nextCursor,
    hasMoreAfter: newer.hasMoreAfter,
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
