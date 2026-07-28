import type {
  ConversationActiveRunSnapshot,
  ConversationLiveTurnSnapshot,
} from "@nervekit/contracts";
import { orderedTurns } from "./active-run.js";
import type { TimelineItem } from "./timeline.js";

/** Latest turn in canonical agent-loop order. */
export function latestActiveTurn(
  activeRun: ConversationActiveRunSnapshot | undefined,
): ConversationLiveTurnSnapshot | undefined {
  return activeRun ? orderedTurns(activeRun).at(-1) : undefined;
}

/**
 * Whether the rendered timeline contains non-user output from one run turn.
 *
 * Timeline ownership keeps this true while a streamed node is replaced by its
 * durable entry. That prevents the per-turn waiting row from reappearing
 * during materialization or after the final assistant message while the run is
 * still completing.
 */
export function hasTurnTimelineOutput(
  timeline: TimelineItem[],
  runId: string | undefined,
  turnId: string | undefined,
): boolean {
  if (!runId || !turnId) return false;

  // Current-turn output normally sits at the tail, so scan newest-first to keep
  // token-by-token projections cheap even for long transcripts.
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item.kind === "message") {
      if (
        item.item.role !== "user" &&
        item.item.runId === runId &&
        item.item.turnId === turnId
      ) {
        return true;
      }
      continue;
    }
    if (item.kind === "tool") {
      if (
        (item.draft?.runId === runId && item.draft.turnId === turnId) ||
        (item.toolCall?.runId === runId && item.toolCall.turnId === turnId)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Whether the latest active turn has produced rendered output yet. */
export function hasActiveTurnTimelineOutput(
  timeline: TimelineItem[],
  activeRun: ConversationActiveRunSnapshot | undefined,
): boolean {
  const turn = latestActiveTurn(activeRun);
  return hasTurnTimelineOutput(timeline, activeRun?.runId, turn?.turnId);
}
