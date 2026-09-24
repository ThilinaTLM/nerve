import type { StatusTone } from "@nervekit/ui-kit/display/status";

import { VIEW_TOOL_DETAILS_LABEL } from "./tool-details-label";
import type { DetailsActionInfo } from "./tool-presentation-types";
import type { ToolCallDisplayRecord } from "./tool-result-parser";
import { countLogicalLines } from "./tool-view-helpers";
import {
  aggregateExploreTasks,
  COLLAPSED_LINES,
  type ToolView,
} from "./tool-result-view";

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Wall-clock elapsed time for work in flight: seconds while short, then a
 * stopwatch-style m:ss so a long-running call stays readable at a glance.
 */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function plural(count: number, singular: string, suffix = "s"): string {
  return `${count} ${singular}${count === 1 ? "" : suffix}`;
}

export function lineCount(text: string | undefined): number {
  return countLogicalLines(text);
}

export function detailsActionFor(
  total: number,
  noun: string,
  direction: "head" | "tail" | "mixed" = "head",
  collapsedCount: number = COLLAPSED_LINES,
): DetailsActionInfo | undefined {
  const hidden = total - collapsedCount;
  if (hidden <= 0) return undefined;
  return detailsActionFromHidden(hidden, noun, direction);
}

export function detailsActionFromHidden(
  hidden: number | undefined,
  noun: string,
  direction: "head" | "tail" | "mixed" = "head",
): DetailsActionInfo | undefined {
  if (!hidden || hidden <= 0) return undefined;
  void noun;
  void direction;
  return {
    hidden,
    label: VIEW_TOOL_DETAILS_LABEL,
  };
}

export function statusDot(
  toolCall: ToolCallDisplayRecord,
  view: ToolView,
): {
  tone: StatusTone;
  pulse: boolean;
} {
  switch (toolCall.status) {
    case "failed":
    case "denied":
      return { tone: "destructive", pulse: false };
    case "cancelled":
      return { tone: "warning", pulse: false };
    case "running":
      return { tone: "info", pulse: true };
    case "committed":
      // Approved but not dispatched: no executing motion.
      return { tone: "info", pulse: false };
    case "waiting":
      return { tone: "warning", pulse: true };
    default:
      break;
  }
  if (
    (view.kind === "bash" || view.kind === "python") &&
    view.exitCode !== undefined &&
    view.exitCode !== 0
  ) {
    return { tone: "destructive", pulse: false };
  }
  if (
    view.kind === "explore" &&
    aggregateExploreTasks(view).summary.failed > 0
  ) {
    return { tone: "destructive", pulse: false };
  }
  return { tone: "success", pulse: false };
}
