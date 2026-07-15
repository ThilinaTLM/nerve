import type { ConversationEntry } from "$lib/api";
import type { ConversationViewState } from "$lib/core/types/state-types";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function active(conversationId: string): boolean {
  return selection.conversationId === conversationId;
}

export function isOpenConversation(conversationId: string): boolean {
  return workspaceState.openCenterTabs.some(
    (tab) => tab.kind === "conversation" && tab.id === conversationId,
  );
}

export function syncActiveView(view: ConversationViewState): void {
  if (!active(view.conversationId)) return;
  workspaceState.error = view.error;
}

export function entryBelongsToActiveBranch(
  view: ConversationViewState,
  entry: ConversationEntry,
): boolean {
  const existingIndex = view.activeEntryIds.indexOf(entry.id);
  if (existingIndex !== -1) return true;
  const activeLeafId = view.activeEntryId ?? view.activeEntryIds.at(-1);
  if (activeLeafId) return entry.parentEntryId === activeLeafId;
  return view.activeEntryIds.length === 0 && !entry.parentEntryId;
}

export function updateConversationActiveEntryId(
  conversationId: string,
  entryId: string,
): void {
  workspaceState.conversations = workspaceState.conversations.map(
    (conversation) =>
      conversation.id === conversationId
        ? {
            ...conversation,
            activeEntryId: entryId,
            updatedAt: new Date().toISOString(),
          }
        : conversation,
  );
}

export function updateTreeNodesForEntry(
  view: ConversationViewState,
  entry: ConversationEntry,
): void {
  const existing = view.treeNodes.find((node) => node.entry.id === entry.id);
  if (existing) {
    view.treeNodes = view.treeNodes.map((node) =>
      node.entry.id === entry.id ? { ...node, entry } : node,
    );
    return;
  }

  view.treeNodes = [
    ...view.treeNodes.map((node) =>
      entry.parentEntryId && node.entry.id === entry.parentEntryId
        ? {
            ...node,
            childEntryIds: Array.from(
              new Set([...node.childEntryIds, entry.id]),
            ),
          }
        : node,
    ),
    { entry, childEntryIds: [] },
  ];
}
