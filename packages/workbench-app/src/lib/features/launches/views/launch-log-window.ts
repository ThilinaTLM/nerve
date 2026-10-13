import type {
  LaunchLogEvent,
  LaunchLogQueryResponse,
} from "@nervekit/contracts/launches";
import type { LogStreamLine } from "$lib/presentation/logs/log-stream";

/**
 * Upper bound for the in-memory log window. Appends trim the oldest events
 * (still reachable by paging back); paging back trims the newest events and
 * detaches the window from the live tail until it is reloaded.
 */
export const MAX_LAUNCH_LOG_WINDOW_EVENTS = 5000;

export function prependLaunchLogPage(
  current: LaunchLogQueryResponse,
  older: LaunchLogQueryResponse,
): LaunchLogQueryResponse {
  const merged = mergeEvents(older.events, current.events);
  if (merged.length > MAX_LAUNCH_LOG_WINDOW_EVENTS) {
    const events = merged.slice(0, MAX_LAUNCH_LOG_WINDOW_EVENTS);
    return {
      ...current,
      launch: older.launch,
      events,
      nextCursor: events.at(-1)?.seq ?? current.nextCursor,
      hasMoreBefore: older.hasMoreBefore,
      hasMoreAfter: true,
      truncated: Boolean(current.truncated || older.truncated),
      previewPath: current.previewPath ?? older.previewPath,
    };
  }
  return {
    ...current,
    launch: older.launch,
    events: merged,
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

export function launchLogLines(
  events: readonly LaunchLogEvent[],
): LogStreamLine[] {
  return events.map((event) => ({
    key: String(event.seq),
    text: event.line,
    stream: event.stream,
    level: event.level,
    tone:
      event.stream === "stderr" || event.level === "error"
        ? "error"
        : event.level === "warn"
          ? "warn"
          : "default",
  }));
}
