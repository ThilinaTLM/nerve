import type { StatusTone } from "@nervekit/ui-kit/components/composites/status-dot";
import { VIEW_TOOL_DETAILS_LABEL } from "./tool-details-label";
import type { DetailsActionInfo, MetaTone } from "./tool-presentation-types";
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
      return { tone: "danger", pulse: false };
    case "cancelled":
      return { tone: "warn", pulse: false };
    case "running":
    case "committed":
      return { tone: "running", pulse: true };
    case "waiting":
      return { tone: "warn", pulse: true };
    default:
      break;
  }
  if (
    (view.kind === "bash" || view.kind === "python") &&
    view.exitCode !== undefined &&
    view.exitCode !== 0
  ) {
    return { tone: "danger", pulse: false };
  }
  if (
    view.kind === "explore" &&
    aggregateExploreTasks(view).summary.failed > 0
  ) {
    return { tone: "danger", pulse: false };
  }
  return { tone: "good", pulse: false };
}

export function toneFromDot(tone: StatusTone): MetaTone {
  switch (tone) {
    case "good":
      return "success";
    case "warn":
      return "warning";
    case "danger":
      return "error";
    case "running":
      return "info";
    default:
      return "default";
  }
}
