import type {
  ContextUsage,
  ConversationEntry,
  ConversationRecord,
  ConversationSnapshot,
  ConversationTree,
  SnapshotCursor,
} from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

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
    await protocolRequest<{ contextUsage: ContextUsage }>(
      "conversation.contextUsage.get",
      { conversationId },
    )
  ).result.contextUsage;
}

export async function getConversationEntries(
  conversationId: string,
): Promise<ConversationEntry[]> {
  return (
    await protocolRequest<{ entries: ConversationEntry[] }>(
      "conversation.entries.list",
      { conversationId },
    )
  ).result.entries;
}

export async function getConversationTree(
  conversationId: string,
): Promise<ConversationTree> {
  return (
    await protocolRequest<{ tree: ConversationTree }>("conversation.tree.get", {
      conversationId,
    })
  ).result.tree;
}

export async function compactConversation(conversationId: string): Promise<{
  conversation: ConversationRecord;
  entry: ConversationEntry;
}> {
  return (
    await protocolRequest<{
      conversation: ConversationRecord;
      entry: ConversationEntry;
    }>("conversation.compact", { conversationId })
  ).result;
}

export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  await protocolRequest<{ ok: true }>("conversation.delete", {
    conversationId,
  });
}
