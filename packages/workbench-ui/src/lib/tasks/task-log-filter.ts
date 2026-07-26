import type { TaskLogEvent } from "@nervekit/contracts";

export type TaskLogLevelFilter = "all" | "warn" | "error";
export type TaskLogStreamFilter = "all" | "stdout" | "stderr";

export interface TaskLogFilterState {
  /** Free text or regular expression source; matching ignores leading/trailing space. */
  readonly text: string;
  readonly useRegex: boolean;
  readonly level: TaskLogLevelFilter;
  readonly stream: TaskLogStreamFilter;
}

export const emptyTaskLogFilter: TaskLogFilterState = {
  text: "",
  useRegex: false,
  level: "all",
  stream: "all",
};

export function isTaskLogFilterActive(filter: TaskLogFilterState): boolean {
  return (
    filter.text.trim().length > 0 ||
    filter.level !== "all" ||
    filter.stream !== "all"
  );
}

export interface TaskLogMatcher {
  readonly match: (event: TaskLogEvent) => boolean;
  readonly error?: string;
}

function matchesLevel(event: TaskLogEvent, level: TaskLogLevelFilter): boolean {
  if (level === "all") return true;
  if (level === "error") return event.level === "error";
  return event.level === "warn" || event.level === "error";
}

/** Compiles a matcher. An invalid regular expression yields a matcher that matches nothing. */
export function compileTaskLogMatcher(
  filter: TaskLogFilterState,
): TaskLogMatcher {
  const text = filter.text.trim();
  const matchesFacets = (event: TaskLogEvent) =>
    matchesLevel(event, filter.level) &&
    (filter.stream === "all" || event.stream === filter.stream);

  if (text.length === 0) return { match: matchesFacets };

  if (filter.useRegex) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(text, "i");
    } catch (error) {
      return {
        match: () => false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      match: (event) => matchesFacets(event) && pattern.test(event.line),
    };
  }

  const needle = text.toLowerCase();
  return {
    match: (event) =>
      matchesFacets(event) && event.line.toLowerCase().includes(needle),
  };
}

export function filterTaskLogEvents(
  events: readonly TaskLogEvent[],
  filter: TaskLogFilterState,
): TaskLogEvent[] {
  if (!isTaskLogFilterActive(filter)) return [...events];
  const matcher = compileTaskLogMatcher(filter);
  return events.filter((event) => matcher.match(event));
}
