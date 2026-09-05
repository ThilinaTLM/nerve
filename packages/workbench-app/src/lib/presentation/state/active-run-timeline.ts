import type {
  ConversationActiveRunSnapshot,
  ConversationLiveMessageSnapshot,
  ConversationLiveToolOutputSnapshot,
  ConversationLiveTurnSnapshot,
} from "@nervekit/contracts/conversations";
import type { ToolCallTranscriptRecord } from "@nervekit/contracts/tools";
import {
  liveBlockKey,
  orderedBlocks,
  orderedMessages,
  orderedTurns,
  toolSlotKey,
} from "./active-run.js";
import {
  byCreatedAtAscending,
  createToolConsumptionTracker,
  isLiveToolCall,
  toolTimelineKey,
} from "./timeline-tool-identity.js";
import type { ConversationTransientState } from "./transcript-types.js";
import type { CommittedContext, TimelineItem } from "./timeline.js";

function shouldAppendUnanchoredToolCall(
  toolCall: ToolCallTranscriptRecord,
  liveOutput: ConversationLiveToolOutputSnapshot | undefined,
  activeRun: ConversationActiveRunSnapshot | undefined,
): boolean {
  // A live timeline is an overlay owned by one active run. Persisted live
  // statuses without that owner are stale/recovery data, not tail content.
  if (!activeRun || toolCall.runId !== activeRun.runId) return false;
  // Output and lifecycle status both remain scoped to the active owner.
  return Boolean(liveOutput) || isLiveToolCall(toolCall);
}

type MessageSlot =
  | { contentIndex: number; order: number; type: "block"; blockIndex: number }
  | {
      contentIndex: number;
      order: number;
      type: "tool";
      toolCall: ToolCallTranscriptRecord;
    };

function anchoredRunToolCallsByMessage(
  activeRun: ConversationActiveRunSnapshot | undefined,
  context: CommittedContext,
): Map<string, ToolCallTranscriptRecord[]> {
  const byMessage = new Map<string, ToolCallTranscriptRecord[]>();
  if (!activeRun) return byMessage;
  for (const toolCall of context.toolCallsByRunId.get(activeRun.runId) ?? []) {
    if (!toolCall.liveMessageId || typeof toolCall.contentIndex !== "number") {
      continue;
    }
    const list = byMessage.get(toolCall.liveMessageId) ?? [];
    list.push(toolCall);
    byMessage.set(toolCall.liveMessageId, list);
  }
  return byMessage;
}

/**
 * Project the transient live tail (streaming assistant content, unified tool
 * activities, run-status, compaction) directly from the canonical active-run
 * snapshot, using the memoized committed `context` instead of recomputing it.
 */
export function buildActiveRunTimeline(
  activeRun: ConversationActiveRunSnapshot | undefined,
  transient: ConversationTransientState | undefined,
  context: CommittedContext,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const consumption = createToolConsumptionTracker({
    initiallyConsumedIds: context.consumedToolCallIds,
    toolCallsById: context.toolCallsById,
    activeRunId: activeRun?.runId,
  });
  const liveOutputFor = (toolCallId: string) =>
    activeRun?.toolOutputsByToolCallId[toolCallId];

  const anchoredByMessage = anchoredRunToolCallsByMessage(activeRun, context);

  if (activeRun) {
    for (const turn of orderedTurns(activeRun)) {
      for (const message of orderedMessages(turn)) {
        emitMessageSlots(items, activeRun, turn, message, {
          context,
          anchoredToolCalls: anchoredByMessage.get(message.liveMessageId) ?? [],
          isToolConsumed: consumption.isConsumed,
          consumeTool: consumption.consume,
          liveOutputFor,
        });
      }
    }
  }

  if (
    activeRun?.retry &&
    activeRun.status === "retrying" &&
    !context.statusRunIds.has(activeRun.runId)
  ) {
    items.push({
      kind: "run_status",
      key: `run-status:${activeRun.runId}`,
      notice: {
        conversationId: activeRun.conversationId,
        agentId: activeRun.agentId,
        runId: activeRun.runId,
        state: "retrying",
        ...activeRun.retry,
      },
    });
  }

  if (
    activeRun?.status === "interrupted" &&
    activeRun.recovery &&
    !context.statusRunIds.has(activeRun.runId)
  ) {
    items.push({
      kind: "run_status",
      key: `run-status:${activeRun.runId}`,
      notice: {
        conversationId: activeRun.conversationId,
        agentId: activeRun.agentId,
        runId: activeRun.runId,
        state: "interrupted",
        errorMessage: activeRun.recovery.errorMessage,
        retryable: activeRun.recovery.continuable,
      },
    });
  }

  if (
    activeRun?.settlement?.phase === "blocked" &&
    !context.statusRunIds.has(activeRun.runId)
  ) {
    items.push({
      kind: "run_status",
      key: `run-status:${activeRun.runId}`,
      notice: {
        conversationId: activeRun.conversationId,
        agentId: activeRun.agentId,
        runId: activeRun.runId,
        state: "failed",
        errorMessage: `Approval processing blocked: ${activeRun.settlement.failure?.message ?? "Unknown failure"} Cancel this run before starting new work.`,
        retryable: false,
      },
    });
  }

  if (transient?.compaction) {
    const duplicateKeys = [
      transient.compaction.id,
      transient.compaction.entryId,
      transient.compaction.runId
        ? `run:${transient.compaction.runId}`
        : undefined,
    ].filter((value): value is string => Boolean(value));
    if (
      !duplicateKeys.some((key) => context.completedCompactionKeys.has(key))
    ) {
      items.push({
        kind: "compaction",
        key: transient.compaction.id,
        notice: transient.compaction,
      });
    }
  }

  const unanchoredToolCandidates = new Map<string, ToolCallTranscriptRecord>();
  const addUnanchoredCandidate = (
    toolCall: ToolCallTranscriptRecord | undefined,
  ) => {
    if (toolCall && !unanchoredToolCandidates.has(toolCall.id)) {
      unanchoredToolCandidates.set(toolCall.id, toolCall);
    }
  };

  for (const toolCall of context.liveCandidateToolCalls)
    addUnanchoredCandidate(toolCall);
  if (activeRun) {
    for (const toolCall of context.toolCallsByRunId.get(activeRun.runId) ?? [])
      addUnanchoredCandidate(toolCall);
    for (const toolCallId of Object.keys(activeRun.toolOutputsByToolCallId)) {
      addUnanchoredCandidate(context.toolCallsById.get(toolCallId));
    }
  }

  for (const toolCall of [...unanchoredToolCandidates.values()].sort(
    byCreatedAtAscending,
  )) {
    const liveOutput = liveOutputFor(toolCall.id);
    if (
      consumption.isConsumed(toolCall) ||
      !shouldAppendUnanchoredToolCall(toolCall, liveOutput, activeRun)
    ) {
      continue;
    }
    items.push({
      kind: "tool",
      key: toolTimelineKey(toolCall),
      toolCall,
      liveOutput,
    });
    consumption.consume(toolCall);
  }

  return items;
}

function emitMessageSlots(
  items: TimelineItem[],
  activeRun: ConversationActiveRunSnapshot,
  turn: ConversationLiveTurnSnapshot,
  message: ConversationLiveMessageSnapshot,
  input: {
    context: CommittedContext;
    anchoredToolCalls: ToolCallTranscriptRecord[];
    isToolConsumed: (toolCall: ToolCallTranscriptRecord) => boolean;
    consumeTool: (
      toolCall: ToolCallTranscriptRecord,
      extraAlias?: string,
    ) => void;
    liveOutputFor: (
      toolCallId: string,
    ) => ConversationLiveToolOutputSnapshot | undefined;
  },
): void {
  const blocks = orderedBlocks(message);
  const slots: MessageSlot[] = blocks.map((block, blockIndex) => ({
    contentIndex: block.contentIndex,
    order: 0,
    type: "block",
    blockIndex,
  }));
  const draftIndexes = new Set(
    blocks
      .filter((block) => block.kind === "tool_call_draft")
      .map((block) => block.contentIndex),
  );
  // Anchored run tools whose transient draft events were missed still render
  // in their canonical slot position.
  for (const toolCall of input.anchoredToolCalls) {
    if (draftIndexes.has(toolCall.contentIndex as number)) continue;
    slots.push({
      contentIndex: toolCall.contentIndex as number,
      order: 1,
      type: "tool",
      toolCall,
    });
  }
  slots.sort((a, b) =>
    a.contentIndex !== b.contentIndex
      ? a.contentIndex - b.contentIndex
      : a.order - b.order,
  );

  for (const slot of slots) {
    if (slot.type === "tool") {
      if (input.isToolConsumed(slot.toolCall)) continue;
      items.push({
        kind: "tool",
        key: toolTimelineKey(slot.toolCall),
        toolCall: slot.toolCall,
        liveOutput: input.liveOutputFor(slot.toolCall.id),
      });
      input.consumeTool(slot.toolCall);
      continue;
    }

    const block = blocks[slot.blockIndex];
    if (block.kind !== "tool_call_draft") {
      if (!block.text && block.kind !== "thinking") continue;
      items.push({
        kind: "message",
        key: liveBlockKey(
          message.liveMessageId,
          block.kind,
          block.contentIndex,
        ),
        item: {
          id: liveBlockKey(
            message.liveMessageId,
            block.kind,
            block.contentIndex,
          ),
          runId: activeRun.runId,
          role: "assistant",
          displayKind: block.kind === "thinking" ? "thinking" : "message",
          text: block.text,
          createdAt: message.startedAt,
          contentIndex: block.contentIndex,
          turnId: turn.turnId,
          messageOrdinal: message.messageOrdinal,
          live: !block.done,
          done: block.done,
          redacted: block.redacted,
        },
      });
      continue;
    }

    const slotKey = toolSlotKey(message.liveMessageId, block.contentIndex);
    // Coordinate-first joining keeps the retained materialized draft as one
    // handoff bridge; provider/source aliases are recovery-only fallbacks.
    const toolCall =
      input.context.toolCallsBySlot.get(slotKey) ??
      (block.providerToolCallId
        ? input.context.toolCallsByProviderId.get(block.providerToolCallId)
        : undefined);
    if (toolCall && input.isToolConsumed(toolCall)) continue;
    items.push({
      kind: "tool",
      key: slotKey,
      draft: {
        key: slotKey,
        runId: activeRun.runId,
        conversationId: activeRun.conversationId,
        turnId: turn.turnId,
        liveMessageId: message.liveMessageId,
        messageOrdinal: message.messageOrdinal,
        startedAt: message.startedAt,
        block,
      },
      toolCall,
      liveOutput: toolCall ? input.liveOutputFor(toolCall.id) : undefined,
    });
    if (toolCall) input.consumeTool(toolCall, block.providerToolCallId);
  }
}
