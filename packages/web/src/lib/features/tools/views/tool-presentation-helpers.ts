import type { ToolCallRecord } from "$lib/api";
import type { StatusTone } from "$lib/components/ui/status-dot";
import type { CollapseInfo, MetaTone } from "./tool-presentation-types";
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
  if (!text) return 0;
  return text.length === 0 ? 0 : text.split("\n").length;
}

export function collapseFor(
  total: number,
  noun: string,
  direction: "head" | "tail" = "head",
): CollapseInfo | undefined {
  const hidden = total - COLLAPSED_LINES;
  if (hidden <= 0) return undefined;
  const verb = direction === "tail" ? "earlier" : "more";
  return {
    hidden,
    expandLabel: `Show ${hidden} ${verb} ${noun}`,
    collapseLabel: "Show less",
  };
}

export function statusDot(
  toolCall: ToolCallRecord,
  view: ToolView,
): {
  tone: StatusTone;
  pulse: boolean;
} {
  switch (toolCall.status) {
    case "error":
    case "denied":
      return { tone: "danger", pulse: false };
    case "running":
    case "requested":
      return { tone: "running", pulse: true };
    case "pending_approval":
    case "waiting_for_user":
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
