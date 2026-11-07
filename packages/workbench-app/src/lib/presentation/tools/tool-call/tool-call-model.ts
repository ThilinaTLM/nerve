import type { MetaItem } from "../../cards/card-presentation";
import type { ToolCallTranscriptRecord } from "../../state/tool-types";
import type { ToolLifecycleStage } from "../lifecycle/registry";
import { hasSharedToolViewBody } from "./tool-details-state";
import type { ToolView } from "../views/tool-result-view";

/** Whether a parsed durable result has anything worth rendering as a body. */
export function hasMeaningfulDurableBody(
  view: ToolView | undefined,
  toolCall: Pick<ToolCallTranscriptRecord, "resultPreview"> | undefined,
): boolean {
  if (!view) return false;
  switch (view.kind) {
    case "bash":
    case "python":
      return view.output.length > 0;
    case "generic":
      return Boolean(view.resultText || view.result.length);
    case "jira":
    case "confluence":
      return toolCall?.resultPreview !== undefined;
    default:
      return hasSharedToolViewBody(view);
  }
}

/** The lifecycle stage the persistent argument section presents for a call. */
export function argumentLifecycleStage(
  toolCall: Pick<ToolCallTranscriptRecord, "status"> | undefined,
): ToolLifecycleStage {
  if (!toolCall) return "drafting";
  if (
    toolCall.status === "failed" ||
    toolCall.status === "denied" ||
    toolCall.status === "cancelled"
  )
    return "failed";
  if (toolCall.status === "completed") return "completed";
  // Approval-only details belong to ApprovalPrompt. The persistent argument
  // section uses the same presentation before and after the decision.
  return "executing";
}

/** Concatenates keyed footer items, keeping the first occurrence of each key. */
export function mergeMetaItems(
  ...groups: Array<readonly MetaItem[]>
): MetaItem[] {
  // Local deduplication scratch space, not reactive component state.
  const seen = new Set<string>();
  return groups
    .flatMap((group) =>
      group.map((item) => ({
        ...item,
        key: item.key ?? `meta:${item.text.replace(/\d+(?:\.\d+)?/g, "#")}`,
      })),
    )
    .filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
}

function parseMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Execution clock for the lead chip. An open running call started when it
 * last changed state (`updatedAt`); settled calls carry `startedAt` from the
 * tool_call_response. Queued calls have not started, so the approval wait is
 * never counted.
 */
export function toolCallTiming(
  toolCall:
    | Pick<
        ToolCallTranscriptRecord,
        "startedAt" | "status" | "updatedAt" | "settledAt"
      >
    | undefined,
): { startedAtMs: number | undefined; settledAtMs: number | undefined } {
  return {
    startedAtMs: toolCall
      ? parseMs(
          toolCall.startedAt ??
            (toolCall.status === "running" ? toolCall.updatedAt : undefined),
        )
      : undefined,
    settledAtMs: parseMs(toolCall?.settledAt),
  };
}

/** Image placeholders reserve their frame from the `size` argument. */
export function toolSizeArgument(argsPreview: unknown): string | undefined {
  const size =
    argsPreview && typeof argsPreview === "object" && "size" in argsPreview
      ? argsPreview.size
      : undefined;
  return typeof size === "string" ? size : undefined;
}
