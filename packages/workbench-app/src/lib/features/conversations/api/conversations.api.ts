import type { ContextUsage } from "@nervekit/contracts/models";
import type {
  ConversationEntry,
  ConversationRecord,
  ConversationSnapshot,
  TimelinePageRequest,
  TimelineTreePageRequest,
  TimelineViewOutcome,
  TranscriptProjectionStatus,
  UpdateConversationStateRequest,
} from "@nervekit/contracts/conversations";
import type { SnapshotCursor } from "@nervekit/contracts/snapshots";
import { protocolRequest } from "@nervekit/protocol/adapters";

export type ConversationSnapshotWithCursor = {
  snapshot: ConversationSnapshot;
  cursor: SnapshotCursor;
};

export async function getConversationSnapshotWithCursor(
  conversationId: string,
): Promise<ConversationSnapshotWithCursor> {
  const { result } = await protocolRequest("snapshot.conversation.get", {
    conversationId,
  });
  return result;
}

export async function getConversationTimelinePage(
  request: TimelinePageRequest,
): Promise<TimelineViewOutcome> {
  return (await protocolRequest("conversation.timeline.page", request)).result;
}

export async function getConversationTimelineTreePage(
  request: TimelineTreePageRequest,
): Promise<TimelineViewOutcome> {
  return (await protocolRequest("conversation.timeline.treePage", request))
    .result;
}

export async function getConversationProjectionStatus(
  conversationId: string,
): Promise<TranscriptProjectionStatus | null> {
  return (
    await protocolRequest("conversation.timeline.projectionStatus", {
      conversationId,
    })
  ).result;
}

export async function getConversationContextUsage(
  conversationId: string,
): Promise<ContextUsage> {
  return (
    await protocolRequest("conversation.contextUsage.get", { conversationId })
  ).result.contextUsage;
}

export async function compactConversation(conversationId: string): Promise<{
  conversation: ConversationRecord;
  entry: ConversationEntry;
}> {
  return (await protocolRequest("conversation.compact", { conversationId }))
    .result;
}

export async function cancelConversationCompaction(
  conversationId: string,
): Promise<void> {
  await protocolRequest("conversation.compaction.cancel", { conversationId });
}

export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  await protocolRequest("conversation.delete", {
    conversationId,
  });
}

export async function updateConversationState(
  conversationId: string,
  request: UpdateConversationStateRequest,
): Promise<ConversationRecord> {
  return (
    await protocolRequest("conversation.state.update", {
      conversationId,
      ...request,
    })
  ).result.conversation;
}
