import type { TaskRecord } from "@nerve/shared";

const urlPattern = /https?:\/\/[^\s)'"]+/i;

/** The detected ready URL, if the task was started with readyOnUrl. */
export function taskUrl(task: TaskRecord): string | undefined {
  if (task.readiness.readyUrl) return task.readiness.readyUrl;
  if (!task.readiness.readyOnUrl) return undefined;
  const matched = task.readiness.matched;
  return matched && urlPattern.test(matched) ? matched : undefined;
}
