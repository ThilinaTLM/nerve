import type { TaskLogEvent, TaskLogQuery } from "@nervekit/contracts";

export type TaskLogPage = {
  events: TaskLogEvent[];
  nextCursor: number;
  firstSeq?: number;
  lastSeq?: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  olderBeforeSeq?: number;
  futureSinceSeq?: number;
  originalEventCount: number;
  displayedEventCount: number;
  omittedEventCount: number;
  mode: string;
};

export function queryTaskLogEvents(
  source: readonly TaskLogEvent[],
  query: TaskLogQuery = {},
): TaskLogPage {
  const mode = query.mode ?? "recent";
  const limit = query.limit ?? 100;
  const ordered = [...source].sort((a, b) => a.seq - b.seq);
  const latestCursor = ordered.at(-1)?.seq ?? 0;

  let matching = eventsForMode(ordered, query);
  if (query.contains) {
    const contains = query.contains.toLowerCase();
    matching = matching.filter((event) =>
      event.line.toLowerCase().includes(contains),
    );
  }
  if (query.regex) {
    const matcher = new RegExp(query.regex, "i");
    matching = matching.filter((event) => matcher.test(event.line));
  }

  const candidates =
    query.beforeSeq === undefined
      ? matching
      : matching.filter((event) => event.seq < query.beforeSeq!);
  const page =
    mode === "since_cursor"
      ? candidates.slice(0, limit)
      : mode === "first_failure"
        ? candidates
        : candidates.slice(-limit);
  const firstSeq = page[0]?.seq;
  const lastSeq = page.at(-1)?.seq;
  const hasMoreBefore =
    firstSeq !== undefined && matching.some((event) => event.seq < firstSeq);
  const hasMoreAfter =
    lastSeq !== undefined && matching.some((event) => event.seq > lastSeq);
  const nextCursor =
    mode === "since_cursor"
      ? (lastSeq ?? query.sinceSeq ?? latestCursor)
      : latestCursor;

  return {
    events: page,
    nextCursor,
    ...(firstSeq !== undefined ? { firstSeq } : {}),
    ...(lastSeq !== undefined ? { lastSeq } : {}),
    hasMoreBefore,
    hasMoreAfter,
    ...(hasMoreBefore && firstSeq !== undefined
      ? { olderBeforeSeq: firstSeq }
      : {}),
    ...(lastSeq !== undefined ? { futureSinceSeq: lastSeq } : {}),
    originalEventCount: matching.length,
    displayedEventCount: page.length,
    omittedEventCount: Math.max(0, matching.length - page.length),
    mode,
  };
}

function eventsForMode(
  ordered: readonly TaskLogEvent[],
  query: TaskLogQuery,
): TaskLogEvent[] {
  const mode = query.mode ?? "recent";
  if (mode === "since_cursor")
    return ordered.filter((event) => event.seq > (query.sinceSeq ?? 0));
  if (mode === "errors")
    return ordered.filter((event) => event.level === "error");
  if (mode === "warnings")
    return ordered.filter((event) => event.level === "warn");
  if (mode === "first_failure") {
    const index = ordered.findIndex((event) => event.level === "error");
    if (index < 0) return [];
    const contextLines = query.contextLines ?? 2;
    return ordered.slice(
      Math.max(0, index - contextLines),
      index + contextLines + 1,
    );
  }
  return [...ordered];
}
