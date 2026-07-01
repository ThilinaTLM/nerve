import type {
  ContextUsage,
  ConversationEntry,
  ConversationRecord,
  ConversationSnapshot,
  ConversationTree,
  SnapshotCursor,
} from "@nervekit/shared";
import {
  apiDeleteNoContent,
  apiGet,
  apiPathSegment,
  apiPost,
} from "../../../core/api/client";
import { protocolRequest } from "../../../core/protocol/http-client";

export type ConversationSnapshotWithCursor = {
  snapshot: ConversationSnapshot;
  cursor: SnapshotCursor;
};

export async function getConversationSnapshotWithCursor(
  conversationId: string,
): Promise<ConversationSnapshotWithCursor> {
  const { result } = await protocolRequest<ConversationSnapshotWithCursor>(
    "snapshot.conversation.get",
    { conversationId },
  );
  return result;
}

export async function getConversationSnapshot(
  conversationId: string,
): Promise<ConversationSnapshot> {
  return (await getConversationSnapshotWithCursor(conversationId)).snapshot;
}

export async function getConversationContextUsage(
  conversationId: string,
): Promise<ContextUsage> {
  return (
    await apiGet<{ contextUsage: ContextUsage }>(
      `/api/conversations/${apiPathSegment(conversationId)}/context-usage`,
    )
  ).contextUsage;
}

export async function getConversationEntries(
  conversationId: string,
): Promise<ConversationEntry[]> {
  return (
    await apiGet<{ entries: ConversationEntry[] }>(
      `/api/conversations/${apiPathSegment(conversationId)}/entries`,
    )
  ).entries;
}

export async function getConversationTree(
  conversationId: string,
): Promise<ConversationTree> {
  return (
    await apiGet<{ tree: ConversationTree }>(
      `/api/conversations/${apiPathSegment(conversationId)}/tree`,
    )
  ).tree;
}

export async function compactConversation(conversationId: string): Promise<{
  conversation: ConversationRecord;
  entry: ConversationEntry;
}> {
  return apiPost(
    `/api/conversations/${apiPathSegment(conversationId)}/compact`,
    {},
  );
}

export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  await apiDeleteNoContent(
    `/api/conversations/${apiPathSegment(conversationId)}`,
  );
}
