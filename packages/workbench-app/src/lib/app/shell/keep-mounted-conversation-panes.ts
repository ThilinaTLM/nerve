import type { CenterTabIdentity } from "$lib/features/workspace";

export const DEFAULT_KEEP_MOUNTED_CONVERSATION_PANE_LIMIT = 4;

export type ConversationPaneTab = Extract<
  CenterTabIdentity,
  { kind: "conversation" | "pending-conversation" }
>;

export function isConversationPaneTab(
  tab: CenterTabIdentity | undefined,
): tab is ConversationPaneTab {
  return tab?.kind === "conversation" || tab?.kind === "pending-conversation";
}

export function conversationPaneTabKey(tab: ConversationPaneTab): string {
  return `${tab.kind}:${tab.id}`;
}

export function conversationPaneTabsEqual(
  left: ConversationPaneTab | undefined,
  right: ConversationPaneTab | undefined,
): boolean {
  return Boolean(
    left && right && left.kind === right.kind && left.id === right.id,
  );
}

export function conversationPaneTabListsEqual(
  left: ConversationPaneTab[],
  right: ConversationPaneTab[],
): boolean {
  return (
    left.length === right.length &&
    left.every((tab, index) => conversationPaneTabsEqual(tab, right[index]))
  );
}

/**
 * Keep the active conversation-like center tab plus the most recently visible
 * panes mounted, bounded by an LRU cap. Non-conversation tabs do not enter the
 * cache; closing a conversation/pending tab evicts it immediately.
 */
export function updateMountedConversationPaneTabs(
  current: ConversationPaneTab[],
  activeTab: CenterTabIdentity | undefined,
  openTabs: CenterTabIdentity[],
  limit = DEFAULT_KEEP_MOUNTED_CONVERSATION_PANE_LIMIT,
): ConversationPaneTab[] {
  const openKeys = new Set(
    openTabs.filter(isConversationPaneTab).map(conversationPaneTabKey),
  );
  const retained = current.filter((tab) =>
    openKeys.has(conversationPaneTabKey(tab)),
  );
  if (!isConversationPaneTab(activeTab)) return retained.slice(0, limit);

  const activeKey = conversationPaneTabKey(activeTab);
  if (!openKeys.has(activeKey)) return retained.slice(0, limit);

  return [
    activeTab,
    ...retained.filter(
      (candidate) => conversationPaneTabKey(candidate) !== activeKey,
    ),
  ].slice(0, limit);
}

/**
 * Svelte effects update the LRU after a render pass. This helper makes the
 * active pane render immediately during that transitional frame, while still
 * preserving already-mounted inactive panes.
 */
export function renderableConversationPaneTabs(
  mounted: ConversationPaneTab[],
  activeTab: CenterTabIdentity | undefined,
  limit = DEFAULT_KEEP_MOUNTED_CONVERSATION_PANE_LIMIT,
): ConversationPaneTab[] {
  if (!isConversationPaneTab(activeTab)) return mounted.slice(0, limit);
  const activeKey = conversationPaneTabKey(activeTab);
  if (mounted.some((tab) => conversationPaneTabKey(tab) === activeKey)) {
    return mounted.slice(0, limit);
  }
  return [activeTab, ...mounted].slice(0, limit);
}
