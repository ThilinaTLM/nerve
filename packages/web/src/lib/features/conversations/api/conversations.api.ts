import type {
  ContextUsage,
  ConversationEntry,
  ConversationRecord,
  ConversationSnapshot,
  ConversationTree,
} from "@nerve/shared";
import {
  apiDeleteNoContent,
  apiGet,
  apiPathSegment,
  apiPost,
} from "../../../shared/api/client";

export async function getConversationSnapshot(
  conversationId: string,
): Promise<ConversationSnapshot> {
  return (
    await apiGet<{ snapshot: ConversationSnapshot }>(
      `/api/conversations/${apiPathSegment(conversationId)}/snapshot`,
    )
  ).snapshot;
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
