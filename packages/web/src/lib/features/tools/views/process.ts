import type { ProcessRecord } from "@nerve/shared";
import type { StatusTone } from "$lib/components/ui/status-dot";

export function processTone(status: ProcessRecord["status"]): StatusTone {
  switch (status) {
    case "running":
    case "ready":
      return "good";
    case "starting":
    case "stopping":
      return "running";
    case "error":
      return "danger";
    case "orphaned":
      return "warn";
    default:
      return "neutral";
  }
}

const urlPattern = /https?:\/\/[^\s)'"]+/i;

/** The detected ready URL, if the process was started with readyOnUrl. */
export function processUrl(process: ProcessRecord): string | undefined {
  if (!process.readiness.readyOnUrl) return undefined;
  const matched = process.readiness.matched;
  return matched && urlPattern.test(matched) ? matched : undefined;
}
