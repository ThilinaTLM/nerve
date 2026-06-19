import type { TaskRecord } from "@nerve/shared";
import type { StatusTone } from "$lib/components/ui/status-dot";

export function taskTone(status: TaskRecord["status"]): StatusTone {
  switch (status) {
    case "running":
    case "ready":
      return "good";
    case "starting":
    case "stopping":
      return "running";
    case "failed":
    case "timed_out":
      return "danger";
    case "orphaned":
      return "warn";
    default:
      return "neutral";
  }
}

const urlPattern = /https?:\/\/[^\s)'"]+/i;

/** The detected ready URL, if the task was started with readyOnUrl. */
export function taskUrl(task: TaskRecord): string | undefined {
  if (task.readiness.readyUrl) return task.readiness.readyUrl;
  if (!task.readiness.readyOnUrl) return undefined;
  const matched = task.readiness.matched;
  return matched && urlPattern.test(matched) ? matched : undefined;
}
