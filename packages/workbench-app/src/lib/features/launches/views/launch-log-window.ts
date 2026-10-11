import type {
  LaunchLogEvent,
  LaunchLogQueryResponse,
} from "@nervekit/contracts/launches";

/**
 * Upper bound for the in-memory log window. Older events stay reachable through
 * backward paging, so trimming keeps long-running launches from growing unbounded.
 */
export const MAX_LAUNCH_LOG_WINDOW_EVENTS = 5000;

export function prependLaunchLogPage(
  current: LaunchLogQueryResponse,
  older: LaunchLogQueryResponse,
): LaunchLogQueryResponse {
  return {
    ...current,
    launch: older.launch,
    events: mergeEvents(older.events, current.events),
    hasMoreBefore: older.hasMoreBefore,
    truncated: Boolean(current.truncated || older.truncated),
    previewPath: current.previewPath ?? older.previewPath,
  };
}

export function appendLaunchLogPage(
  current: LaunchLogQueryResponse,
  newer: LaunchLogQueryResponse,
): LaunchLogQueryResponse {
  const merged = mergeEvents(current.events, newer.events);
  const overflow = Math.max(0, merged.length - MAX_LAUNCH_LOG_WINDOW_EVENTS);
  return {
    ...current,
    launch: newer.launch,
    events: overflow > 0 ? merged.slice(overflow) : merged,
    nextCursor: newer.nextCursor,
    hasMoreAfter: newer.hasMoreAfter,
    hasMoreBefore: overflow > 0 ? true : current.hasMoreBefore,
    truncated: Boolean(current.truncated || newer.truncated),
    previewPath: newer.previewPath ?? current.previewPath,
  };
}

function mergeEvents(
  first: readonly LaunchLogEvent[],
  second: readonly LaunchLogEvent[],
): LaunchLogEvent[] {
  const bySequence = new Map<number, LaunchLogEvent>();
  for (const event of first) bySequence.set(event.seq, event);
  for (const event of second) bySequence.set(event.seq, event);
  return [...bySequence.values()].sort((a, b) => a.seq - b.seq);
}
