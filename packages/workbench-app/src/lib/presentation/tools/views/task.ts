import type { TaskToolSummaryPayload } from "@nervekit/contracts";

const urlPattern = /https?:\/\/[^\s)'"]+/i;

/** The detected ready URL, if the task was started with readyOnUrl. */
export function taskUrl(task: TaskToolSummaryPayload): string | undefined {
  if (task.readiness.readyUrl) return task.readiness.readyUrl;
  if (!task.readiness.readyOnUrl) return undefined;
  const matched = task.readiness.matched;
  return matched && urlPattern.test(matched) ? matched : undefined;
}
